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
 *     (/api/assinar-com-cadastro, /api/mp, /api/asaas, /api/criar-conta-checkout).
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
const ALVOS_PAGAMENTO = ['/api/assinar-com-cadastro', '/api/mp', '/api/asaas', '/api/criar-conta-checkout', '/api/agendar-plano'];
const JANELA_DIAS = 10;
const DEDUP_DIAS = 30;
const TETO_ENVIOS = 20;

function corpoEmail(nome) {
  const primeiro = String(nome || '').trim().split(' ')[0] || 'investidor';
  return {
    subject: 'Seu acesso ao Investidor Pro — deu algo errado no pagamento?',
    text: `Olá, ${primeiro}!\n\nVimos que você tentou concluir a assinatura na BidPro Brasil e algo deu errado no caminho — em alguns casos foi um problema técnico nosso com extensões de navegador (bloqueadores de anúncio), que já corrigimos.\n\nSe quiser tentar de novo, está funcionando normalmente: https://www.bidprobrasil.com.br/#/checkout?plano=top2\n\nDica: se usar bloqueador de anúncios ou extensão de privacidade, desative para o nosso site só durante o pagamento.\n\nE se preferir, é só responder este e-mail que a nossa equipe te ajuda a concluir.\n\nAbraço,\nEquipe BidPro Brasil`,
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

  const candidatos = [...new Set([...(erros || []), ...(evs || [])].map(r => r.user_id))];
  if (!candidatos.length) return res.status(200).json({ ok: true, candidatos: 0, enviados: 0 });

  // Dedup: quem já recebeu recuperação nos últimos 30 dias sai da lista.
  // `error` CHECADO e ABORTA: se esta leitura falhar e virar lista vazia, "ninguém
  // recebeu ainda" — e TODOS os já contatados receberiam de novo. Melhor não mandar
  // hoje do que mandar duplicado.
  const { data: jaEnviados, error: eDedupLe } = await supabase.from('eventos_atividade')
    .select('user_id').eq('tipo', 'recuperacao_checkout_email').gte('criado_em', dedupDesde)
    .in('user_id', candidatos);
  if (eDedupLe) return res.status(500).json({ error: 'dedup_ilegivel', detalhe: eDedupLe.message });
  const bloqueados = new Set((jaEnviados || []).map(r => r.user_id));

  const { data: perfis, error: ePerfis } = await supabase.from('perfis')
    .select('id, nome, role, ativo').in('id', candidatos);
  if (ePerfis) return res.status(500).json({ error: 'perfis_ilegiveis', detalhe: ePerfis.message });
  const aptos = (perfis || []).filter(p =>
    p.ativo && (p.role || 'explorador') === 'explorador' && !bloqueados.has(p.id));

  let enviados = 0;
  const resultados = [];
  for (const p of aptos.slice(0, TETO_ENVIOS)) {
    // E-mail vem do auth (perfis não o guarda) — via admin API do Supabase.
    let email = null;
    try {
      const { data: u } = await supabase.auth.admin.getUserById(p.id); // padrao-ok: best-effort por usuário — sem e-mail, este usuário é PULADO (continue abaixo), nunca vira envio errado
      email = u?.user?.email || null;
    } catch { /* segue sem este usuário */ }
    if (!email) continue;

    const corpo = corpoEmail(p.nome);
    const r = await enviarEmail({
      to: email,
      subject: corpo.subject,
      text: corpo.text,
      replyTo: 'contato@bidprobrasil.com.br',
      meta: { userId: p.id, tipo: 'recuperacao_checkout' },
    });
    // Só grava o dedup quando o envio FOI aceito — envio falho hoje deve tentar amanhã.
    if (r && r.ok !== false) {
      // O DEDUP é o que impede o mesmo cliente de receber isto de novo amanhã. Se a gravação
      // falhar, precisa GRITAR no log — o e-mail já saiu e não volta; repetir vira spam.
      const { error: eDedup } = await supabase.from('eventos_atividade').insert({
        user_id: p.id, tipo: 'recuperacao_checkout_email', alvo: 'checkout',
        detalhe: `enviado para ${email}`,
      });
      if (eDedup) console.error('[recuperacao] DEDUP NAO GRAVADO para', p.id, eDedup.message);
      enviados++;
      resultados.push(p.id);
    }
  }

  return res.status(200).json({ ok: true, candidatos: candidatos.length, aptos: aptos.length, enviados, usuarios: resultados });
}
