/**
 * GET /api/recuperacao-checkout-cron — RECUPERAÇÃO DE VENDA (diário, 13:00 UTC)
 *
 * Pedido do dono (18/08): "esse tipo de mensagem deve acontecer como uma recuperação de
 * venda no checkout de qualquer produto". O caso que originou: Romualdo tentou assinar o
 * Top2 QUATRO vezes entre 06 e 17/08 (extensão do navegador matava o fetch), leu "Failed
 * to fetch" e desistiu — 11 dias sem ninguém procurá-lo, com o rastro completo no banco.
 *
 * O QUE FAZ: acha quem TENTOU pagar/assinar e não virou pagante, e manda UM e-mail humano
 * de recuperação. Fontes do rastro (as mesmas que o diagnóstico usa):
 *   - `erros_cliente` com rota /checkout e user_id (erro de runtime na tela de pagamento);
 *   - `eventos_atividade` tipo api_erro/api_falha_rede com alvo de pagamento
 *     (/api/assinar-com-cadastro, /api/mp, /api/asaas, /api/criar-conta-checkout);
 *   - `compras_produtos` com status 'pendente' — ver abaixo.
 *
 * VALE PARA QUALQUER PRODUTO OU ASSINATURA (26/08). Até aqui o cron só enxergava
 * assinatura, apesar de o pedido de 18/08 já dizer "qualquer produto". Três coisas o
 * prendiam ao plano: os alvos de pagamento não incluíam a compra avulsa; a rota vigiada
 * era só `/checkout`, e produto se compra em `/p/{tipo}/{id}`; e o e-mail era escrito
 * para assinatura, com link fixo do Investidor Pro.
 *
 * O quarto era o mais silencioso: o filtro `role === 'explorador'` faz sentido para
 * assinatura (quem já assina não recebe convite para assinar), mas EXCLUI justamente o
 * assinante que abandona a compra de um curso — o comprador mais provável de todos.
 * Agora esse filtro só se aplica ao rastro de assinatura.
 *
 * Para produto existe um rastro melhor do que inferir por erro de API: `comprar_produto_iniciar`
 * grava a compra como 'pendente' ANTES de mandar a pessoa ao gateway. Pendente que envelhece
 * é abandono explícito, com produto e valor identificados — não é dedução, é registro.
 *
 * REGRAS ANTI-SPAM (aprendidas do "retenção que nudava o admin", 08/08):
 *   - só role atual 'explorador' (quem pagou não recebe recuperação de venda);
 *   - conta interna NUNCA (admin/analista/juridico/suporte/consultor);
 *   - UM e-mail por usuário a cada 30 dias — dedup por evento `recuperacao_checkout_email`
 *     em eventos_atividade (o envio grava o evento; o filtro o lê);
 *   - teto de 20 envios por execução;
 *   - janela de rastro: últimos 10 dias (tentativa velha demais não é recuperação, é ruído).
 */
import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { enviarEmail } from './_email.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const ROLES_INTERNAS = new Set(['admin', 'analista', 'juridico', 'suporte', 'consultor', 'advogado']);
const ALVOS_PAGAMENTO = ['/api/assinar-com-cadastro', '/api/mp', '/api/asaas', '/api/criar-conta-checkout', '/api/agendar-plano', '/api/registrar-compra-produto'];
const JANELA_DIAS = 10;
// Carência antes de tratar pendente como abandono: o webhook do gateway pode demorar, e
// PIX/boleto legitimamente ficam pendentes por horas. Mandar antes disso é cobrar quem
// está pagando agora.
const PENDENTE_MIN_HORAS = 6;
const DEDUP_DIAS = 30;
const TETO_ENVIOS = 20;

function corpoEmail(nome) {
  const primeiro = String(nome || '').trim().split(' ')[0] || 'investidor';
  return {
    subject: 'Seu acesso ao Investidor Pro — deu algo errado no pagamento?',
    text: `Olá, ${primeiro}!\n\nVimos que você tentou concluir a assinatura na BidPro Brasil e algo deu errado no caminho — em alguns casos foi um problema técnico nosso com extensões de navegador (bloqueadores de anúncio), que já corrigimos.\n\nSe quiser tentar de novo, está funcionando normalmente: https://www.bidprobrasil.com.br/#/checkout?plano=top2\n\nDica: se usar bloqueador de anúncios ou extensão de privacidade, desative para o nosso site só durante o pagamento.\n\nE se preferir, é só responder este e-mail que a nossa equipe te ajuda a concluir.\n\nAbraço,\nEquipe BidPro Brasil`,
  };
}

// Recuperação de COMPRA DE PRODUTO (curso, eBook, ou o que vier depois). O texto cita o
// produto pelo nome: e-mail genérico de "você abandonou algo" não converte, e com ticket
// alto a pessoa precisa reconhecer na primeira linha o que ficou pelo caminho.
function corpoEmailProduto(nome, produto) {
  const primeiro = String(nome || '').trim().split(' ')[0] || 'investidor';
  const titulo = produto?.titulo || 'o material que você escolheu';
  const link = produto?.tipo && produto?.id
    ? `https://www.bidprobrasil.com.br/#/p/${produto.tipo}/${produto.id}`
    : 'https://www.bidprobrasil.com.br/#/membros';
  return {
    subject: `Sua compra de ${titulo} ficou pelo caminho`,
    text: `Olá, ${primeiro}!\n\nVocê começou a compra de ${titulo} na BidPro Brasil e o pagamento não chegou a ser concluído.\n\nSe foi problema técnico, já deve estar funcionando: ${link}\n\nDica: se usar bloqueador de anúncios ou extensão de privacidade, desative para o nosso site só durante o pagamento.\n\nE se ficou alguma dúvida sobre o conteúdo antes de decidir, é só responder este e-mail — eu mesmo te respondo.\n\nAbraço,\nEquipe BidPro Brasil`,
  };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'nao_autorizado' });

  const desde = new Date(Date.now() - JANELA_DIAS * 24 * 3600 * 1000).toISOString();
  const dedupDesde = new Date(Date.now() - DEDUP_DIAS * 24 * 3600 * 1000).toISOString();

  // Rastro 1: erro de runtime na tela de checkout, de usuário logado.
  const { data: erros, error: e1 } = await supabase.from('erros_cliente')
    .select('user_id').eq('rota', '/checkout').not('user_id', 'is', null).gte('ultima_em', desde);
  // Rastro 2: chamada de pagamento que falhou (rede ou HTTP), com usuário.
  const { data: evs, error: e2 } = await supabase.from('eventos_atividade')
    .select('user_id').in('tipo', ['api_erro', 'api_falha_rede']).in('alvo', ALVOS_PAGAMENTO)
    .not('user_id', 'is', null).gte('criado_em', desde);
  // Leitura falhou não vira "ninguém para recuperar": aborta com erro para o cron acusar.
  if (e1 || e2) return res.status(500).json({ error: 'leitura_falhou', detalhe: (e1 || e2).message });

  // Rastro 3: COMPRA DE PRODUTO iniciada e nunca concluída. `comprar_produto_iniciar`
  // grava 'pendente' antes de mandar ao gateway; se nunca virou 'ativo', ficou pelo caminho.
  const ateAgora = new Date(Date.now() - PENDENTE_MIN_HORAS * 3600 * 1000).toISOString();
  const { data: pendentes, error: e3 } = await supabase.from('compras_produtos')
    .select('user_id, produto_tipo, produto_id, criado_em')
    .eq('status', 'pendente').not('user_id', 'is', null)
    .gte('criado_em', desde).lte('criado_em', ateAgora);
  if (e3) return res.status(500).json({ error: 'pendentes_ilegiveis', detalhe: e3.message });

  // Quem JÁ comprou o mesmo produto depois (outra tentativa que deu certo) não é abandono.
  // Sem isto, quem errou o cartão e pagou em seguida receberia e-mail dizendo que não pagou.
  const usuariosPend = [...new Set((pendentes || []).map(r => r.user_id))];
  let jaComprou = new Set();
  if (usuariosPend.length) {
    const { data: ativas, error: eAt } = await supabase.from('compras_produtos')
      .select('user_id, produto_id').eq('status', 'ativo').in('user_id', usuariosPend);
    if (eAt) return res.status(500).json({ error: 'ativas_ilegiveis', detalhe: eAt.message });
    jaComprou = new Set((ativas || []).map(r => `${r.user_id}|${r.produto_id}`));
  }
  // Um abandono por usuário+produto, o mais recente.
  const abandonos = new Map();
  for (const r of (pendentes || [])) {
    const k = `${r.user_id}|${r.produto_id}`;
    if (jaComprou.has(k)) continue;
    const anterior = abandonos.get(k);
    if (!anterior || new Date(r.criado_em) > new Date(anterior.criado_em)) abandonos.set(k, r);
  }

  const candidatos = [...new Set([
    ...(erros || []).map(r => r.user_id),
    ...(evs || []).map(r => r.user_id),
    ...[...abandonos.values()].map(r => r.user_id),
  ])];
  if (!candidatos.length) return res.status(200).json({ ok: true, candidatos: 0, enviados: 0 });

  // Dedup: quem já recebeu recuperação nos últimos 30 dias sai da lista.
  // `error` CHECADO e ABORTA: se esta leitura falhar e virar lista vazia, "ninguém
  // recebeu ainda" — e TODOS os já contatados receberiam de novo. Melhor não mandar
  // hoje do que mandar duplicado.
  // O dedup é por usuário + ALVO, não só por usuário: quem abandonou o curso A e depois o
  // curso B merece os dois e-mails — são vendas diferentes. Travar por usuário faria a
  // segunda venda perdida ficar invisível por 30 dias.
  const { data: jaEnviados, error: eDedupLe } = await supabase.from('eventos_atividade')
    .select('user_id, alvo').eq('tipo', 'recuperacao_checkout_email').gte('criado_em', dedupDesde)
    .in('user_id', candidatos);
  if (eDedupLe) return res.status(500).json({ error: 'dedup_ilegivel', detalhe: eDedupLe.message });
  const bloqueados = new Set((jaEnviados || []).map(r => `${r.user_id}|${r.alvo || 'checkout'}`));

  const { data: perfis, error: ePerfis } = await supabase.from('perfis')
    .select('id, nome, role, ativo').in('id', candidatos);
  if (ePerfis) return res.status(500).json({ error: 'perfis_ilegiveis', detalhe: ePerfis.message });
  const porId = new Map((perfis || []).map(p => [p.id, p]));
  const interna = (p) => ROLES_INTERNAS.has(String(p?.role || '').toLowerCase());

  // Nome do produto para o e-mail. Sem ele o texto sairia genérico — e um e-mail que não
  // diz O QUE ficou pelo caminho não recupera venda de ticket alto.
  const idsCurso = [...new Set([...abandonos.values()].filter(a => a.produto_tipo === 'curso').map(a => a.produto_id))];
  const idsEbook = [...new Set([...abandonos.values()].filter(a => a.produto_tipo === 'ebook').map(a => a.produto_id))];
  const titulos = new Map();
  if (idsCurso.length) {
    const { data, error } = await supabase.from('cursos_admin').select('id, titulo').in('id', idsCurso);
    if (error) return res.status(500).json({ error: 'cursos_ilegiveis', detalhe: error.message });
    (data || []).forEach(c => titulos.set(c.id, c.titulo));
  }
  if (idsEbook.length) {
    const { data, error } = await supabase.from('ebooks_admin').select('id, titulo').in('id', idsEbook);
    if (error) return res.status(500).json({ error: 'ebooks_ilegiveis', detalhe: error.message });
    (data || []).forEach(e => titulos.set(e.id, e.titulo));
  }

  // ── A FILA DE ENVIO ────────────────────────────────────────────────────────
  // Assinatura: só quem AINDA é explorador (quem já assina não recebe convite para assinar).
  // Produto: qualquer cliente, inclusive assinante — é ele quem mais compra curso, e o filtro
  // de explorador o excluía justamente por já ser bom cliente.
  const fila = [];
  const usuariosAssinatura = new Set([...(erros || []), ...(evs || [])].map(r => r.user_id));
  for (const uid of usuariosAssinatura) {
    const p = porId.get(uid);
    if (!p || !p.ativo || interna(p)) continue;
    if ((p.role || 'explorador') !== 'explorador') continue;
    if (bloqueados.has(`${uid}|checkout`)) continue;
    fila.push({ perfil: p, alvo: 'checkout', produto: null });
  }
  for (const a of abandonos.values()) {
    const p = porId.get(a.user_id);
    if (!p || !p.ativo || interna(p)) continue;
    const alvo = `produto:${a.produto_id}`;
    if (bloqueados.has(`${a.user_id}|${alvo}`)) continue;
    // Não mandar dois e-mails ao mesmo usuário na mesma execução.
    if (fila.some(f => f.perfil.id === p.id)) continue;
    fila.push({ perfil: p, alvo, produto: { tipo: a.produto_tipo, id: a.produto_id, titulo: titulos.get(a.produto_id) } });
  }

  let enviados = 0;
  const resultados = [];
  for (const item of fila.slice(0, TETO_ENVIOS)) {
    const p = item.perfil;
    // E-mail vem do auth (perfis não o guarda) — via admin API do Supabase.
    let email = null;
    try {
      const { data: u } = await supabase.auth.admin.getUserById(p.id); // padrao-ok: best-effort por usuário — sem e-mail, este usuário é PULADO (continue abaixo), nunca vira envio errado
      email = u?.user?.email || null;
    } catch { /* segue sem este usuário */ }
    if (!email) continue;

    const corpo = item.produto ? corpoEmailProduto(p.nome, item.produto) : corpoEmail(p.nome);
    const r = await enviarEmail({
      to: email,
      subject: corpo.subject,
      text: corpo.text,
      replyTo: 'contato@bidprobrasil.com.br',
      meta: { userId: p.id, tipo: item.produto ? 'recuperacao_produto' : 'recuperacao_checkout' },
    });
    // Só grava o dedup quando o envio FOI aceito — envio falho hoje deve tentar amanhã.
    if (r && r.ok !== false) {
      // O DEDUP é o que impede o mesmo cliente de receber isto de novo amanhã. Se a gravação
      // falhar, precisa GRITAR no log — o e-mail já saiu e não volta; repetir vira spam.
      const { error: eDedup } = await supabase.from('eventos_atividade').insert({
        user_id: p.id, tipo: 'recuperacao_checkout_email', alvo: item.alvo,
        detalhe: `enviado para ${email}`,
      });
      if (eDedup) console.error('[recuperacao] DEDUP NAO GRAVADO para', p.id, item.alvo, eDedup.message);
      enviados++;
      resultados.push({ user: p.id, alvo: item.alvo });
    }
  }

  return res.status(200).json({ ok: true, candidatos: candidatos.length, aptos: fila.length, abandonos_produto: abandonos.size, enviados, usuarios: resultados });
}
