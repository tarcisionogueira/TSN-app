/**
 * /api/whatsapp-responder — a IA que RESPONDE no WhatsApp oficial (receptivo).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Acordado pelo `whatsapp-webhook.js` a cada mensagem (latência de segundos) e por cron de
 * 5 min (rede de segurança). Lê `wa_mensagens` pendentes, agrupa por conversa e responde UMA
 * vez cobrindo tudo que a pessoa mandou em sequência.
 *
 * O AGENTE É O MESMO DO CHAT DO SITE (`responderSuporte` em chat-suporte.js, canal
 * 'whatsapp'): mesmas regras de privacidade, mesmos planos, mesmo marcador de escalar. Não
 * existe "IA do WhatsApp" separada para divergir da do site.
 *
 * QUANDO NÃO RESPONDE (e grava o PORQUÊ em `resposta_erro`, nunca some calado):
 *  - `WA_BOT_ATIVO` ≠ '1'      → dormente: não reivindica nada, só conta a fila;
 *  - humano assumiu (`ia_pausada_ate` no futuro: escalou, ou a equipe respondeu pelo app);
 *  - fora da janela de 24 h da última mensagem da pessoa (a Meta só aceita modelo aprovado).
 *
 * ESCALAR ([[ESCALAR]]/[[BUG]] do agente): a resposta sai (o agente avisa que um especialista
 * vai responder), a IA PAUSA 12 h naquela conversa e o dono recebe e-mail com o telefone e a
 * última mensagem — ele responde pelo app WhatsApp Business (coexistência) e o echo mantém a
 * pausa viva.
 *
 * ENVS (nomes, nunca valores): WA_BOT_ATIVO, WA_TOKEN (token permanente de usuário do sistema),
 * WA_PHONE_NUMBER_ID, CLAUDE_KEY, CRON_SECRET, ADMIN_ALERT_EMAIL (opcional).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { responderSuporte } from './chat-suporte.js';
import { enviarEmail } from './_email.js';
import { pedidoRepetido, CORPO_REPETIDO } from './_pedido-unico.js';
import { enviarTextoWhatsapp, enviarTextoOficial, regrasDoCanal, faltaParaEnviar } from './_whatsapp-envio.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const JANELA_MS = 24 * 3600 * 1000;
const PAUSA_ESCALADA_MS = 12 * 3600 * 1000;
const ORCAMENTO_MS = 45000;

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// CATÁLOGO VIVO para a IA vender (01/10, dono: "foco em venda do sistema pago, na sequência os
// cursos (ainda não cadastrados) e e-books"). Lido do banco — planos_config e ebooks_admin — para a
// IA nunca citar preço velho ou produto que não existe. Cursos só entram quando houver ativo.
const SITE = 'https://www.bidprobrasil.com.br';
const UTM = 'utm_source=whatsapp&utm_medium=ia&utm_campaign=perpetuo';
// O app é HashRouter: `/planos` sem "#" cai na HOME (o rewrite manda tudo para o index.html). A
// rota vai depois do "#" e a UTM antes — `capturarMarketing` lê a query de antes do "#". Os links
// /p/ebook e /p/curso passam pelo og-share, que já redireciona para /#/p/... levando a query.
const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function montarCatalogoWa({ planos = [], ebooks = [], cursos = [] } = {}) {
  const linhas = [];
  const pro = planos.find((p) => p.plano_key === 'top2' && p.ativo);
  if (pro) linhas.push(`- PLANO ${pro.nome} (prioridade): ${brl(pro.preco)}/mês${pro.preco_anual ? ` ou ${brl(pro.preco_anual)}/ano` : ''} — relatórios de mercado e jurídico ilimitados por imóvel, filtros e calculadora. Link: ${SITE}/?${UTM}&utm_content=plano_pro#/planos`);
  const vei = planos.find((p) => p.plano_key === 'veiculos' && p.ativo);
  if (vei) linhas.push(`- PLANO ${vei.nome} (quem quer carro/moto/caminhão de leilão): ${brl(vei.preco)}/mês${vei.preco_anual ? ` ou ${brl(vei.preco_anual)}/ano` : ''} — leilões de veículos com leiloeiro, link do lote e relatório por IA. Link: ${SITE}/?${UTM}&utm_content=plano_veiculos#/planos`);
  const combo = planos.find((p) => p.plano_key === 'combo' && p.ativo);
  if (combo) linhas.push(`- ${combo.nome} (quem quer imóveis E veículos): ${brl(combo.preco)}/mês${combo.preco_anual ? ` ou ${brl(combo.preco_anual)}/ano` : ''}. Link: ${SITE}/?${UTM}&utm_content=plano_combo#/planos`);
  const ass = planos.find((p) => p.plano_key === 'assessorado' && p.ativo);
  if (ass) linhas.push(`- ${ass.nome} (equipe faz a arrematação com o cliente, do edital à posse): ${brl(ass.preco)} parcelado${ass.preco_vista ? ` ou ${brl(ass.preco_vista)} à vista` : ''}${Number(ass.honorarios_exito_pct) > 0 ? ` + ${Number(ass.honorarios_exito_pct)}% de êxito sobre a arrematação` : ''}. Fechamento é com consultor: encerre com [[ESCALAR]] quando ela quiser.`);
  for (const e of ebooks.filter((x) => x.ativo && Number(x.preco) > 0).slice(0, 6)) {
    linhas.push(`- E-BOOK "${e.titulo}": ${brl(e.preco)}${e.concede_plano === 'top2' && e.concede_meses ? ` (inclui ${e.concede_meses} mês do Investidor Pro)` : ''}. Link: ${SITE}/p/ebook/${e.id}?${UTM}&utm_content=ebook`);
  }
  // Curso PAGO e ativo (o "Comece aqui" gratuito de onboarding não é produto para vender).
  const cs = cursos.filter((c) => c.ativo && Number(c.preco) > 0);
  for (const c of cs.slice(0, 6)) linhas.push(`- CURSO "${c.titulo}"${Number(c.preco) > 0 ? `: ${brl(c.preco)}` : ''}. Link: ${SITE}/p/curso/${c.id}?${UTM}&utm_content=curso`);
  if (!cs.length) linhas.push('- CURSOS: nenhum disponível ainda — não ofereça.');
  linhas.push(`- CONTA GRÁTIS (só para ver os imóveis): ${SITE}/?${UTM}&utm_content=conta_gratis`);
  return linhas.join('\n');
}
let _catalogo = { em: 0, texto: '' };
async function catalogoWa() {
  if (_catalogo.texto && Date.now() - _catalogo.em < 10 * 60_000) return _catalogo.texto;
  try {
    const [planos, ebooks, cursos] = await Promise.all([
      sb('GET', 'planos_config?select=plano_key,nome,preco,preco_vista,preco_anual,honorarios_exito_pct,ativo&plano_key=in.(top2,assessorado,veiculos,combo)'),
      sb('GET', 'ebooks_admin?select=id,titulo,preco,ativo,concede_plano,concede_meses&ativo=eq.true&order=criado_em.asc'),
      sb('GET', 'cursos_admin?select=id,titulo,preco,ativo&ativo=eq.true'),
    ]);
    _catalogo = { em: Date.now(), texto: montarCatalogoWa({ planos: planos || [], ebooks: ebooks || [], cursos: cursos || [] }) };
  } catch (e) {
    // Sem catálogo a IA segue pelo SYSTEM (sem preço, direciona à página de Planos) — nunca inventa.
    console.warn('[wa-resp] catálogo ilegível, IA segue sem preços:', e?.message || e);
  }
  return _catalogo.texto;
}

export function limparSaidaWa(texto) {
  return String(texto || '')
    .replace(/\[\[[A-Z]+:?[^\]]*\]?\]?/g, '')
    .replace(/https?:\/\/[^\s)]+/gi, (u) => (/^https?:\/\/(?:www\.)?bidprobrasil\.com\.br(?:[/?#]|$)/i.test(u) ? u : '[link removido]'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Variantes do telefone para achar o perfil (cadastro guarda com/sem DDI, com/sem máscara). */
export function variantesTelefone(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  const semDdi = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  const vs = new Set([d, semDdi, `55${semDdi}`]);
  // Celular com 9º dígito: a Meta às vezes entrega SEM ele (número antigo) — tenta os dois.
  if (semDdi.length === 10) vs.add(`${semDdi.slice(0, 2)}9${semDdi.slice(2)}`);
  if (semDdi.length === 11 && semDdi[2] === '9') vs.add(`${semDdi.slice(0, 2)}${semDdi.slice(3)}`);
  if (semDdi.length === 11) vs.add(`(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 7)}-${semDdi.slice(7)}`);
  return [...vs].filter((v) => v.replace(/\D/g, '').length >= 10);
}

/** Cloud API direta — mantida com este nome para os testes antigos; o envio real usa o canal ativo. */
export const enviarTextoWa = enviarTextoOficial;

// SAIR / PARAR: a pessoa pediu para não receber mais. Responde UMA confirmação curta (sem IA),
// marca optout e cancela o que estiver na fila ativa para ela. Só mensagem curta e direta —
// "não quero sair do grupo" numa frase longa não é pedido de descadastro.
export function pedidoDeSaida(texto) {
  const t = String(texto || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[!.?\s]+$/g, '');
  return t.length <= 40 && /^(sair|parar|pare|stop|cancelar|descadastrar|nao quero (mais )?(receber|mensagens?)|remover|me remova|me tire da lista)$/.test(t);
}

// Interesse estruturado a partir da linha [[PERFIL: ...; interesse=X]] — vira coluna para segmentar.
const INTERESSES = new Set(['investidor_pro', 'veiculos', 'combo', 'assessoria', 'ebook', 'indefinido']);
export function interesseDoPerfil(perfil) {
  const m = /interesse\s*=\s*([a-z_]+)/i.exec(String(perfil || ''));
  if (!m) return null;
  const v = m[1].toLowerCase() === 'plano' ? 'investidor_pro' : m[1].toLowerCase();
  return INTERESSES.has(v) ? v : null;
}

// Código que o widget do site manda ("código BP-1a2b3c4d") — casa a conversa com o cadastro
// mesmo quando o telefone do WhatsApp não é o do perfil.
export function codigoClienteDoTexto(texto) {
  const m = /\bBP-([0-9a-f]{8})\b/i.exec(String(texto || ''));
  return m ? m[1].toLowerCase() : null;
}

// LIÇÕES DO SDR: sugestões que o agente de aprendizado (whatsapp-sdr-aprendizado-cron) extraiu das
// conversas e que o DONO marcou como aplicadas no Admin → Qualidade. Só as aprovadas entram no
// prompt: as conversas vêm de terceiros, e texto delas nunca vira instrução sem revisão humana.
let _licoes = { em: 0, texto: '' };
async function licoesSdr() {
  if (Date.now() - _licoes.em < 10 * 60_000) return _licoes.texto;
  try {
    const rows = await sb('GET', 'aprendizado_sugestoes?escopo=eq.whatsapp_sdr&aplicado=eq.true&select=detalhe&order=criado_em.desc&limit=3') || [];
    const itens = rows.flatMap((r) => (Array.isArray(r?.detalhe?.sugestoes) ? r.detalhe.sugestoes : []))
      .map((it) => [it.titulo, it.acao].filter(Boolean).join(': ').replace(/[\r\n]+/g, ' ').slice(0, 240))
      .filter(Boolean).slice(0, 12);
    _licoes = { em: Date.now(), texto: itens.length ? ` Lições aprovadas pela equipe a partir de conversas anteriores (siga-as): ${itens.map((t) => `• ${t}`).join(' ')}` : '' };
  } catch (e) {
    console.warn('[wa-resp] lições do SDR ilegíveis (segue sem):', e?.message || e);
    _licoes = { em: Date.now(), texto: '' };
  }
  return _licoes.texto;
}

async function marcar(ids, patch) {
  if (!ids.length) return;
  await sb('PATCH', `wa_mensagens?id=in.(${ids.join(',')})`, patch, 'return=minimal');
}

async function atender(tel, pendentes) {
  const ids = pendentes.map((m) => m.id);
  // Reivindica: só o que AINDA está pendente vira 'processando' — dois disparos simultâneos
  // (webhook + cron) não respondem a mesma mensagem duas vezes.
  const minhas = await sb('PATCH', `wa_mensagens?id=in.(${ids.join(',')})&resposta_status=eq.pendente&select=id`,
    { resposta_status: 'processando' }, 'return=representation');
  const meus = (minhas || []).map((m) => m.id);
  if (!meus.length) return 'ja_reivindicada';

  const [conv] = await sb('GET', `wa_conversas?telefone=eq.${encodeURIComponent(tel)}&select=*`) || [];
  const agora = Date.now();
  if (conv?.ia_pausada_ate && Date.parse(conv.ia_pausada_ate) > agora) {
    await marcar(meus, { resposta_status: 'ignorada', resposta_erro: 'humano assumiu a conversa' });
    return 'pausada';
  }
  // Janela de 24 h só existe na Cloud API oficial; pela Evolution não há essa regra.
  if (regrasDoCanal().janela24h && (!conv?.ultima_msg_deles_em || agora - Date.parse(conv.ultima_msg_deles_em) > JANELA_MS)) {
    await marcar(meus, { resposta_status: 'ignorada', resposta_erro: 'fora da janela de 24h' });
    return 'fora_janela';
  }
  // Atendente ASSUMIU o chamado na tela de Atendimento (ou ele está esperando um): a IA não fala
  // por cima. Finalizar o chamado devolve a conversa à IA (a próxima mensagem abre outro).
  if (conv?.chamado_id) {
    const [ch] = (await sb('GET', `chamados?id=eq.${conv.chamado_id}&select=status`).catch(() => [])) || [];
    if (ch && ['em_atendimento', 'aguardando_atendente'].includes(ch.status)) {
      await marcar(meus, { resposta_status: 'ignorada', resposta_erro: `chamado ${ch.status} — humano conduz` });
      return 'humano_no_chamado';
    }
  }
  if (pendentes.some((m) => pedidoDeSaida(m.texto))) {
    const ok = 'Tudo certo, não vou mais te enviar mensagens. Se precisar de algo sobre leilões, é só chamar por aqui.';
    let idOk = null;
    try { idOk = await enviarTextoWhatsapp(tel, ok); } catch (e) { console.warn('[wa-resp] confirmação de saída não saiu:', e?.message || e); }
    if (idOk) await sb('POST', 'wa_mensagens?on_conflict=wamid', { wamid: idOk, telefone: tel, direcao: 'enviada', autor: 'ia', texto: ok, ocorrido_em: new Date().toISOString() }, 'resolution=ignore-duplicates,return=minimal');
    await sb('PATCH', `wa_conversas?telefone=eq.${encodeURIComponent(tel)}`, { optout_em: new Date().toISOString() }, 'return=minimal');
    await sb('PATCH', `wa_disparos?telefone=eq.${encodeURIComponent(tel)}&status=in.(agendado,enviando)`, { status: 'cancelado', erro: 'pediu SAIR' }, 'return=minimal').catch(() => {});
    await marcar(meus, { resposta_status: 'respondida', resposta_erro: 'optout' });
    return 'optout';
  }
  // Respondeu a uma mensagem ATIVA: a fila para de insistir (sem lembrete) e o funil conta.
  await sb('PATCH', `wa_disparos?telefone=eq.${encodeURIComponent(tel)}&status=eq.enviado`, { status: 'respondido' }, 'return=minimal').catch(() => {});

  // Quem é: perfil pelo telefone (uma vez; depois fica em wa_conversas.user_id).
  let perfil = null;
  try {
    if (conv.user_id) [perfil] = await sb('GET', `perfis?id=eq.${conv.user_id}&select=id,nome,role`) || [];
    else {
      const vs = variantesTelefone(tel).map((v) => `"${v}"`).join(',');
      const achados = await sb('GET', `perfis?telefone=in.(${encodeURIComponent(vs)})&select=id,nome,role&limit=2`) || [];
      if (achados.length === 1) perfil = achados[0];
      // Veio pelo botão do site: a 1ª mensagem traz "código BP-xxxxxxxx" (8 primeiros hex do id).
      const cod = !perfil && pendentes.map((m) => codigoClienteDoTexto(m.texto)).find(Boolean);
      if (cod) [perfil] = (await sb('POST', 'rpc/wa_perfil_por_codigo', { p_codigo: cod })) || [];
      if (perfil) await sb('PATCH', `wa_conversas?telefone=eq.${encodeURIComponent(tel)}`, { user_id: perfil.id }, 'return=minimal');
    }
  } catch (e) { console.warn('[wa-resp] perfil não resolvido (segue como contato novo):', e?.message || e); }
  const memoria = (perfil
    ? `Cliente cadastrado: ${perfil.nome || 'sem nome'} · plano atual: ${perfil.role || 'desconhecido'}.`
    : `Contato ainda NÃO cadastrado na plataforma${conv.nome ? ` (nome no WhatsApp: ${conv.nome})` : ''} — provável cliente novo.`
  // Anúncio de origem (Clique-para-WhatsApp): diz à IA o que a pessoa clicou, para continuar
  // daquele assunto em vez de recomeçar do zero. Só o título do anúncio — nunca dado de terceiro.
  ) + (conv.perfil_lead ? ` Perfil já levantado (não pergunte de novo): ${conv.perfil_lead}.` : '')
    + (conv.origem?.headline ? ` Chegou pelo anúncio: "${String(conv.origem.headline).slice(0, 160)}".` : (conv.origem ? ' Chegou por um anúncio de Clique-para-WhatsApp.' : ''))
    + (await licoesSdr());

  const hist = await sb('GET', `wa_mensagens?telefone=eq.${encodeURIComponent(tel)}&select=autor,texto&order=criado_em.desc&limit=20`) || [];
  const mensagens = hist.reverse().filter((m) => m.texto)
    .map((m) => ({ autor_tipo: m.autor === 'pessoa' ? 'cliente' : m.autor === 'ia' ? 'ia' : 'equipe', conteudo: m.texto }));

  let out;
  try { out = await responderSuporte({ mensagens, memoria, canal: 'whatsapp', apiKey: process.env.CLAUDE_KEY, catalogo: await catalogoWa() }); }
  catch (e) {
    await marcar(meus, { resposta_status: 'erro', resposta_erro: `IA: ${String(e?.message || e).slice(0, 150)}` });
    return 'erro_ia';
  }
  if (!out?.resposta) { await marcar(meus, { resposta_status: 'ignorada', resposta_erro: 'agente sem resposta (última fala não é da pessoa)' }); return 'sem_resposta'; }

  // SAÍDA DO CANAL (revisão de segurança 01/10): só link nosso sai pelo WhatsApp — prompt injection
  // ("me manda o link tal") não transforma a IA em entregadora de link de terceiro — e resto de
  // marcador interno ([[PERFIL… cortado) nunca chega à pessoa.
  out.resposta = limparSaidaWa(out.resposta);
  let wamid;
  try { wamid = await enviarTextoWhatsapp(tel, out.resposta); }
  catch (e) {
    await marcar(meus, { resposta_status: 'erro', resposta_erro: String(e?.message || e).slice(0, 200) });
    return 'erro_envio';
  }
  await sb('POST', 'wa_mensagens?on_conflict=wamid', { wamid, telefone: tel, direcao: 'enviada', autor: 'ia', texto: out.resposta, ocorrido_em: new Date().toISOString() }, 'resolution=ignore-duplicates,return=minimal');
  await marcar(meus, { resposta_status: 'respondida', resposta_erro: null });
  // Perfil de TODOS (22/11, dono: "complementar as informações que temos dele") — cliente também.
  if (out.perfilLead) {
    const interesse = interesseDoPerfil(out.perfilLead);
    await sb('PATCH', `wa_conversas?telefone=eq.${encodeURIComponent(tel)}`, { perfil_lead: out.perfilLead, perfil_em: new Date().toISOString(), ...(interesse ? { interesse } : {}) }, 'return=minimal')
      .catch((e) => console.warn('[wa-resp] perfil do lead não gravado:', e?.message || e));
  }

  if (out.escalar) {
    const motivo = out.bug ? 'falha relatada (BUG)' : 'pedido de atendimento humano';
    await sb('PATCH', `wa_conversas?telefone=eq.${encodeURIComponent(tel)}`, {
      escalada_em: new Date().toISOString(), escalada_motivo: motivo,
      ia_pausada_ate: new Date(agora + PAUSA_ESCALADA_MS).toISOString(),
    }, 'return=minimal');
    const ultima = pendentes[pendentes.length - 1]?.texto || '';
    // `conv.nome` é o NOME DE PERFIL do WhatsApp — quem escreve escolhe o que quiser, inclusive
    // HTML (`<a href=…>clique aqui</a>`). Ia cru no e-mail de alerta da equipe: um link de
    // terceiro dentro de um aviso que a equipe confia (revisão de segurança 01/10). Tudo que vem
    // da pessoa passa pelo mesmo escape; o telefone só com dígitos (vai em href).
    const escH = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
    const nomeContato = String(conv.nome || perfil?.nome || '').replace(/[\r\n]+/g, ' ').slice(0, 80);
    const telDig = String(tel).replace(/\D/g, '');
    const env = await enviarEmail({
      to: process.env.ADMIN_ALERT_EMAIL || 'tarcisioaraujo@reimob.com.br',
      subject: `WhatsApp: ${nomeContato || tel} precisa de você (${motivo})`,
      html: `<p><b>${escH(nomeContato || 'Contato')}</b> — +${telDig}${perfil ? ` · cliente (${escH(perfil.role)})` : ' · ainda não cadastrado'}</p>
             <p><b>Última mensagem:</b><br>${escH(ultima)}</p>
             <p>A IA avisou que um especialista vai responder e ficou PAUSADA por 12 h nesta conversa. Responda pela tela de <a href="${SITE}/#/atendimento">Atendimento</a> (sai pelo WhatsApp) ou pelo celular: <a href="https://wa.me/${telDig}">abrir conversa</a>.</p>`,
      meta: { tipo: 'whatsapp_escalada', userId: perfil?.id || null },
    }).catch((e) => ({ ok: false, error: e?.message }));
    if (!env?.ok) console.error('[wa-resp] aviso de escalada NÃO saiu:', env?.error || 'motivo desconhecido');
    return 'respondida_escalada';
  }
  return 'respondida';
}

export default async function handler(req, res) {
  if (await pedidoRepetido(req, 'whatsapp-responder')) { res.status(409).json(CORPO_REPETIDO); return; } // comando repetido pela rede/navegador (30/10)
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SB || !SVC) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // Reivindicada e abandonada (a função morreu no meio): volta para a fila. 15 min é muito
  // acima do orçamento de uma rodada (45 s), então não pega trabalho de outra em andamento.
  if (process.env.WA_BOT_ATIVO === '1') {
    await sb('PATCH', `wa_mensagens?resposta_status=eq.processando&criado_em=lt.${new Date(Date.now() - 15 * 60000).toISOString()}`,
      { resposta_status: 'pendente' }, 'return=minimal').catch((e) => console.warn('[wa-resp] não devolvi as abandonadas:', e?.message || e));
  }
  const fila = await sb('GET', 'wa_mensagens?resposta_status=eq.pendente&select=id,telefone,texto,criado_em&order=criado_em.asc&limit=60')
    .catch((e) => ({ erro: e.message }));
  if (fila?.erro) { res.status(502).json({ ok: false, erro: fila.erro }); return; }

  if (process.env.WA_BOT_ATIVO !== '1') { res.status(200).json({ ok: true, dormente: true, pendentes: fila.length }); return; }
  const faltam = [...faltaParaEnviar(), ...(process.env.CLAUDE_KEY ? [] : ['CLAUDE_KEY'])];
  // Ligado sem credencial NÃO é "nada a fazer": é falha de configuração, e tem de aparecer.
  if (faltam.length) { res.status(500).json({ ok: false, erro: 'configuração incompleta', faltam, pendentes: fila.length }); return; }

  const porTel = new Map();
  for (const m of fila) porTel.set(m.telefone, [...(porTel.get(m.telefone) || []), m]);
  const t0 = Date.now();
  const resultado = {};
  for (const [tel, pend] of porTel) {
    if (Date.now() - t0 > ORCAMENTO_MS) { resultado.sem_tempo = (resultado.sem_tempo || 0) + 1; continue; }
    const r = await atender(tel, pend).catch((e) => { console.error('[wa-resp]', tel, e?.message || e); return 'erro'; });
    resultado[r] = (resultado[r] || 0) + 1;
  }
  console.log('[wa-resp]', JSON.stringify(resultado));
  res.status(200).json({ ok: true, conversas: porTel.size, ...resultado });
}
