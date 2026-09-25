/**
 * POST /api/email-caixa  (equipe) — a parte SERVIDOR da caixa de e-mail de /atendimento.
 * Ler, mover de pasta, marcar lido e bloquear remetente a tela faz direto no banco (RLS de
 * `email_caixa`/`email_bloqueados`, só equipe). Aqui fica o que precisa de segredo:
 *
 *   { acao: 'enviar', de: 'suporte'|'contato'|'privacidade', para: [..], cc?: [..],
 *     assunto, texto, responder_a?: <id em email_caixa> }
 *   { acao: 'anexo', id: <id em email_caixa>, anexo_id } → { url } (link temporário do Resend)
 *
 * Resposta a e-mail que virou CHAMADO: o reply-to leva o token do chamado
 * (suporte+<token>@) e a mensagem entra no histórico do chamado como do atendente — a
 * resposta do cliente volta para o MESMO chamado e a fila conta a resposta humana.
 * Envio passa por `enviarEmail` (orçamento diário + lista de supressão, como todo o resto).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN   = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const DOMINIO      = 'bidprobrasil.com.br';
// Espelha public.pode_caixa_email(): admin + analista + consultor (role OU funcao_equipe).
const PAPEIS_CAIXA = ['admin', 'analista', 'consultor'];
const CAIXAS_ENVIO = ['suporte', 'contato', 'privacidade'];
const RE_EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
const MAX_TEXTO = 20000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
}
function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
async function ler1(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  const [linha] = await r.json();
  return linha || null;
}
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const listaEmails = (v) => [...new Set([].concat(v || []).flatMap(x => String(x || '').split(/[,;\s]+/))
  .map(x => x.trim().toLowerCase()).filter(Boolean))];

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  let perfil;
  try { perfil = await ler1(`perfis?id=eq.${user.id}&select=role,funcao_equipe,nome`); }
  catch (e) { console.error('[email-caixa] perfil:', e.message); return json({ error: 'Não foi possível verificar seu acesso agora.' }, 500); }
  // Advogado (23/09): usa só a PRÓPRIA caixa pessoal — envia por ela, nunca pela comunicação.
  const soPessoal = [perfil?.role, perfil?.funcao_equipe].includes('advogado')
    && !(PAPEIS_CAIXA.includes(perfil?.role) || PAPEIS_CAIXA.includes(perfil?.funcao_equipe));
  if (!perfil || !(soPessoal || PAPEIS_CAIXA.includes(perfil.role) || PAPEIS_CAIXA.includes(perfil.funcao_equipe))) {
    return json({ error: 'A caixa de e-mail é só da equipe.' }, 403);
  }

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // ─── ANEXO sob demanda: o binário fica no Resend; pedimos um link temporário na hora ───
  if (body?.acao === 'anexo') {
    const id = String(body?.id || ''), anexoId = String(body?.anexo_id || '');
    let msg;
    try { msg = await ler1(`email_caixa?id=eq.${encodeURIComponent(id)}&select=direcao,resend_email_id,anexos,dono`); }
    catch (e) { console.error('[email-caixa] anexo:', e.message); return json({ error: 'Não foi possível ler a mensagem.' }, 500); }
    // Mesma cerca da RLS (a chave aqui é de serviço): caixa pessoal só o dono; comunicação só
    // quem tem acesso a ela (advogado não).
    if (msg && (msg.dono ? msg.dono !== user.id : soPessoal)) return json({ error: 'Anexo não encontrado' }, 404);
    const key = process.env.RESEND_API_KEY;
    if (!key) return json({ error: 'Envio de e-mail não configurado' }, 503);

    // ENVIADO (23/09): o arquivo é o que o Resend de fato ANEXOU no envio — GET
    // /emails/{id}/attachments. Mostra exatamente o que o destinatário recebeu, não uma
    // releitura da origem (que pode ter mudado, ou exigir login — caso da matrícula LEILOFY).
    if (msg?.direcao === 'saida') {
      const idx = Number(body?.anexo_idx);
      const esperado = (msg.anexos || [])[idx];
      if (!msg.resend_email_id || !esperado) return json({ error: 'Anexo não encontrado' }, 404);
      const rl = await fetch(`https://api.resend.com/emails/${encodeURIComponent(msg.resend_email_id)}/attachments`,
        { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
      const jl = rl.ok ? await rl.json().catch(() => null) : null;
      const itens = Array.isArray(jl?.data) ? jl.data : (Array.isArray(jl) ? jl : null);
      if (!itens) {
        console.error('[email-caixa] anexos enviados: Resend', rl.status, jl ? Object.keys(jl).join(',') : '(sem corpo)');
        return json({ error: `O provedor não listou os anexos deste envio (HTTP ${rl.status}).` }, 502);
      }
      const alvo = itens.find(a => a?.filename === esperado.nome) || itens[idx];
      let url = alvo?.download_url || null;
      if (!url && alvo?.id) {
        const ra = await fetch(`https://api.resend.com/emails/${encodeURIComponent(msg.resend_email_id)}/attachments/${encodeURIComponent(alvo.id)}`,
          { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
        const ja = ra.ok ? await ra.json().catch(() => null) : null;
        url = ja?.download_url || null;
        if (!url) console.error('[email-caixa] anexo enviado: Resend', ra.status, ja ? Object.keys(ja).join(',') : '(sem corpo)');
      }
      if (!url) return json({ error: 'O provedor não entregou o anexo agora. Tente de novo em instantes.' }, 502);
      return json({ ok: true, url });
    }

    // Só anexo que É desta mensagem — o id vem do cliente e não pode virar proxy do Resend.
    if (!msg?.resend_email_id || !(msg.anexos || []).some(a => a?.id && a.id === anexoId)) return json({ error: 'Anexo não encontrado' }, 404);
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(msg.resend_email_id)}/attachments/${encodeURIComponent(anexoId)}`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    const j = r.ok ? await r.json().catch(() => null) : null;
    if (!j?.download_url) {
      console.error('[email-caixa] anexo: Resend', r.status, j ? Object.keys(j).join(',') : '(sem corpo)');
      return json({ error: 'O provedor não entregou o anexo agora. Tente de novo em instantes.' }, 502);
    }
    return json({ ok: true, url: j.download_url });
  }

  if (body?.acao !== 'enviar') return json({ error: 'acao inválida' }, 400);

  const rl = await checkRateLimit(`email-caixa:user:${user.id}`, 80, 86_400_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  // 'pessoal' = o endereço da própria pessoa (equipe_email). Os demais são de COMUNICAÇÃO.
  let pessoal = null;
  if (soPessoal && body?.acao === 'enviar') body.de = 'pessoal';
  if (body?.de === 'pessoal') {
    try { pessoal = await ler1(`equipe_email?user_id=eq.${user.id}&select=endereco`); }
    catch (e) { console.error('[email-caixa] equipe_email:', e.message); return json({ error: 'Não foi possível ler seu endereço da equipe.' }, 500); }
    if (!pessoal) return json({ error: 'Você ainda não tem endereço pessoal @bidprobrasil.com.br — peça ao admin.' }, 400);
  }
  const de = pessoal ? null : (CAIXAS_ENVIO.includes(body?.de) ? body.de : 'suporte');
  const enderecoDe = pessoal ? pessoal.endereco : `${de}@${DOMINIO}`;
  const para = listaEmails(body?.para);
  const cc = listaEmails(body?.cc).filter(e => !para.includes(e));
  const assunto = String(body?.assunto || '').trim().slice(0, 300);
  const texto = String(body?.texto || '').trim().slice(0, MAX_TEXTO);
  if (!para.length || [...para, ...cc].some(e => !RE_EMAIL.test(e))) return json({ error: 'Confira os destinatários (e-mail inválido).' }, 400);
  if (para.length + cc.length > 10) return json({ error: 'No máximo 10 destinatários por mensagem.' }, 400);
  if (!assunto || !texto) return json({ error: 'Assunto e mensagem são obrigatórios.' }, 400);

  // Resposta: encadeia no fio do remetente e, se virou chamado, no chamado.
  let original = null, chamado = null;
  if (body?.responder_a) {
    try {
      original = await ler1(`email_caixa?id=eq.${encodeURIComponent(body.responder_a)}&select=id,de_email,de_nome,assunto,texto,message_id,referencias,chamado_id,criado_em,dono`);
      if (original && (original.dono ? original.dono !== user.id : soPessoal)) original = null; // mesma cerca da RLS
      if (original?.chamado_id) chamado = await ler1(`chamados?id=eq.${original.chamado_id}&select=id,email_token,canal`);
    } catch (e) { console.error('[email-caixa] original:', e.message); return json({ error: 'Não foi possível ler a mensagem original.' }, 500); }
    if (!original) return json({ error: 'Mensagem original não encontrada' }, 404);
  }

  // Para onde volta a resposta (23/09, decisão do dono):
  //   · chamado        → suporte+<token do chamado>@ (volta ao MESMO chamado)
  //   · endereço pessoal → pessoa+<token do envio>@ (volta à caixa dela, encadeada)
  //   · comunicação    → o próprio endereço (contato@/suporte@…) → cai na fila de atendimento
  const respostaToken = (!chamado && pessoal) ? crypto.randomUUID().replace(/-/g, '').slice(0, 24) : null;
  let replyTo = respostaToken ? enderecoDe.replace('@', `+${respostaToken}@`) : enderecoDe;
  if (chamado) {
    let token = chamado.email_token;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const up = await sb(`chamados?id=eq.${chamado.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { email_token: token } });
      if (!up.ok) { console.error('[email-caixa] token do chamado não gravado', up.status); token = null; }
    }
    if (token) replyTo = `suporte+${token}@${DOMINIO}`;
  }

  const headers = {};
  if (original?.message_id) {
    headers['In-Reply-To'] = original.message_id;
    headers['References'] = `${original.referencias || ''} ${original.message_id}`.trim().slice(0, 2000);
  }
  // 25/09 (dono): a resposta leva SÓ o que foi digitado + assinatura. A conversa inteira fica na
  // tela para dar contexto a quem responde; citar o e-mail anterior virou opção (`citar: true`).
  // Antes citava sempre — e como o e-mail do outro lado já traz o histórico dentro, ia quase a
  // conversa toda junto. In-Reply-To/References continuam: o fio segue encadeado lá do outro lado.
  const citacao = body?.citar === true && original?.texto
    ? `\n\nEm ${new Date(original.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, ${original.de_nome || original.de_email} escreveu:\n`
      + String(original.texto).slice(0, 4000).split('\n').map(l => `> ${l}`).join('\n')
    : '';
  const nomeRemetente = perfil.nome || 'Equipe BidPro Brasil';
  const textoFinal = `${texto}\n\n—\n${nomeRemetente}\nBidPro Brasil${citacao}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#1e293b;line-height:1.6;white-space:pre-wrap">${esc(texto)}</div>`
    + `<p style="font-family:Arial,Helvetica,sans-serif;color:#475569;font-size:13px;margin-top:18px">—<br>${esc(nomeRemetente)}<br>BidPro Brasil</p>`
    + (citacao ? `<blockquote style="border-left:3px solid #cbd5e1;margin:16px 0 0;padding:4px 12px;color:#64748b;white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:13px">${esc(citacao.trim())}</blockquote>` : '');

  // Toque duplo no celular (25/09): o mesmo e-mail saiu 2× ao leiloeiro, 1,1 s de diferença, com
  // dois ids do Resend. A tela gera uma chave por mensagem composta; com ela o Resend devolve o
  // envio original em vez de mandar de novo, e o registro abaixo não duplica em Enviados.
  const chaveEnvio = /^[A-Za-z0-9-]{8,64}$/.test(String(body?.chave_envio || '')) ? String(body.chave_envio) : null;
  const r = await enviarEmail({
    from: `${nomeRemetente} (BidPro Brasil) <${enderecoDe}>`,
    to: para, cc, replyTo, subject: assunto, html, text: textoFinal,
    headers: Object.keys(headers).length ? headers : undefined,
    meta: { tipo: 'caixa_equipe', userId: user.id },
    idempotencyKey: chaveEnvio ? `caixa:${user.id}:${chaveEnvio}` : undefined,
  });
  if (!r.ok) {
    const msg = r.error === 'orcamento_diario_excedido'
      ? 'Limite diário de envio atingido — a mensagem foi colocada na fila e sai amanhã.'
      : r.error === 'suprimido' ? 'O destinatário está na lista de supressão (endereço com bounce/reclamação). Nada foi enviado.'
      : `Não foi possível enviar agora: ${r.error || 'falha desconhecida'}`;
    return json({ error: msg, enfileirado: !!r.enfileirado }, r.error === 'suprimido' ? 409 : 502);
  }

  // Registro na caixa (Enviados). O e-mail JÁ SAIU — falha aqui é só histórico: avisa, não esconde.
  const avisos = [];
  if (r.id) {
    const ja = await sb(`email_caixa?resend_email_id=eq.${encodeURIComponent(r.id)}&select=id&limit=1`);
    const linhas = ja.ok ? await ja.json().catch(() => null) : null;
    if (!ja.ok || !Array.isArray(linhas)) console.error('[email-caixa] checagem de repetido falhou HTTP', ja.status, '— registrando assim mesmo');
    else if (linhas.length) return json({ ok: true, id: r.id, repetido: true, avisos: ['este envio já tinha saído — não foi mandado de novo'] });
  }
  const ins = await sb('email_caixa', { method: 'POST', prefer: 'return=minimal', body: {
    direcao: 'saida', pasta: 'enviados', caixa: enderecoDe, de_email: enderecoDe, de_nome: nomeRemetente, dono: pessoal ? user.id : null,
    para, cc, assunto, texto: textoFinal, html, in_reply_to: original?.message_id || null,
    referencias: headers['References'] || null, resend_email_id: r.id || null, lido: true,
    chamado_id: chamado?.id || null, enviado_por: user.id, resposta_token: respostaToken,
  } });
  if (!ins.ok) { console.error('[email-caixa] registrar enviado HTTP', ins.status); avisos.push('enviado, mas não ficou registrado em Enviados'); }

  if (original) {
    const lido = await sb(`email_caixa?id=eq.${original.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { lido: true } });
    if (!lido.ok) console.error('[email-caixa] marcar lido HTTP', lido.status);
  }
  if (chamado) {
    const m = await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal', body: {
      chamado_id: chamado.id, autor_id: user.id, autor_nome: nomeRemetente, autor_tipo: 'atendente',
      conteudo: texto, canal: 'email',
    } });
    if (!m.ok) { console.error('[email-caixa] histórico do chamado HTTP', m.status); avisos.push('enviado, mas não entrou no histórico do chamado'); }
    else await sb(`chamados?id=eq.${chamado.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { atualizado_em: new Date().toISOString() } });
  }

  return json({ ok: true, id: r.id || null, avisos });
}
