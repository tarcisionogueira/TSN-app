/**
 * /api/email-cobranca-cron — "Cobrar posição" (17/10, pedido do dono).
 *
 * O dono liga a cobrança num e-mail que ENVIOU pela caixa pessoal (CaixaEmail → CobrarPosicao.jsx, tabela
 * email_cobranca): a cada 7, 15 ou 30 dias sai um "Re:" curto para o mesmo destinatário, do endereço dele, com
 * o e-mail original citado. Para sozinho quando:
 *   - o destinatário RESPONDE: entrada ligada pelo +token a um dos envios (resposta_de), ou vinda de um dos
 *     destinatários com o mesmo assunto depois do envio original (resposta que caiu fora do token);
 *   - bate o limite (3): na data seguinte, sem resposta, encerra e avisa o dono;
 *   - o dono desliga na tela.
 * Dias úteis só (seg–sex, horário de Brasília). Idempotente por (cobrança, nº do envio). `?seco=1` só mostra.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import crypto from 'node:crypto';
import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM_ALERTA  = process.env.APP_ALERTS_FROM || 'BidPro Brasil <alertas@bidprobrasil.com.br>';
const POR_RODADA   = 30;
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dataBR = (s) => new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const nucleoAssunto = (s) => String(s || '').replace(/^\s*((re|res|fwd?|enc|rv)\s*:\s*)+/i, '').trim().toLowerCase();

async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}
async function atualizar(id, campos) {
  const r = await sb(`email_cobranca?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...campos, atualizado_em: new Date().toISOString() }) });
  const linhas = r.ok ? await r.json().catch(() => []) : [];
  if (!linhas.length) throw new Error(`atualizar cobrança ${id} HTTP ${r.status}`);
}
const encerrar = (c, motivo) => atualizar(c.id, { ativo: false, encerrado_motivo: motivo, encerrado_em: new Date().toISOString() });

async function emailDoUsuario(userId) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
  if (!r.ok) { console.error(`[email-cobranca] e-mail do usuário ${userId}: HTTP ${r.status}`); return null; }
  return (await r.json())?.email || null;
}

// Respondeu? (a) entrada ligada pelo +token a um dos envios; (b) de um dos destinatários, mesmo assunto, depois.
async function respondeu(orig, c) {
  const cadeia = [orig.id, ...(c.envios || [])].join(',');
  const [porToken] = await ler(`email_caixa?direcao=eq.entrada&resposta_de=in.(${cadeia})&select=id&limit=1`);
  if (porToken) return true;
  const de = (orig.para || []).map((e) => String(e).toLowerCase()).filter((e) => /^[^@\s,()]+@[^@\s,()]+$/.test(e));
  if (!de.length) return false;
  const lista = await ler(`email_caixa?direcao=eq.entrada&de_email=in.(${de.map(encodeURIComponent).join(',')})&criado_em=gt.${encodeURIComponent(orig.criado_em)}&select=assunto&limit=50`);
  const alvo = nucleoAssunto(orig.assunto);
  return lista.some((m) => alvo && nucleoAssunto(m.assunto) === alvo);
}

async function processar(c, { seco }) {
  const [orig] = await ler(`email_caixa?id=eq.${c.email_id}&select=id,para,cc,assunto,texto,criado_em,caixa,dono,caso_id`);
  if (!orig || orig.dono !== c.user_id || !orig.caixa) { if (!seco) await encerrar(c, 'erro'); return { id: c.id, erro: 'e-mail original não encontrado na caixa pessoal' }; }
  if (await respondeu(orig, c)) { if (!seco) await encerrar(c, 'respondido'); return { id: c.id, respondido: true }; }

  if (c.enviadas >= c.max_cobrancas) {
    if (seco) return { id: c.id, limite: true };
    await encerrar(c, 'limite');
    const para = await emailDoUsuario(c.user_id);
    if (para) {
      const env = await enviarEmail({ from: FROM_ALERTA, to: para, subject: `Sem resposta após ${c.enviadas} cobranças · ${orig.assunto || '(sem assunto)'}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1e293b;line-height:1.6"><p>Cobrei <b>${c.enviadas}×</b> (a cada ${c.intervalo_dias} dias) o e-mail
          "<b>${esc(orig.assunto)}</b>" enviado em ${dataBR(orig.criado_em)} para ${esc((orig.para || []).join(', '))} e não houve resposta.</p>
          <p>Parei de cobrar. Se quiser insistir, ligue de novo na conversa ou faça contato por outro canal.</p>
          <p><a href="${BASE}/#/caixa" style="background:#0D63DB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Abrir a caixa</a></p></div>`,
        meta: { tipo: 'cobranca_posicao_limite', userId: c.user_id } }).catch((e) => ({ ok: false, error: e?.message }));
      if (!env?.ok) console.error('[email-cobranca] aviso de limite ao dono falhou:', env?.error);
    }
    return { id: c.id, limite: true };
  }

  const n = c.enviadas + 1;
  const [perfil] = await ler(`perfis?id=eq.${c.user_id}&select=nome`);
  const nome = perfil?.nome || 'Equipe BidPro Brasil';
  const assunto = `Re: ${String(orig.assunto || '').replace(/^\s*((re|res|fwd?)\s*:\s*)+/i, '')}`.slice(0, 300);
  const corpo = `Olá, tudo bem?\n\nRetomo o e-mail que enviei em ${dataBR(orig.criado_em)}, abaixo. Consegue me dar uma posição?\n\nObrigado.`;
  const citado = String(orig.texto || '').slice(0, 2500).split('\n').map((l) => `> ${l}`).join('\n');
  const texto = `${corpo}\n\n—\n${nome}\nBidPro Brasil\n\nEm ${dataBR(orig.criado_em)}, ${nome} escreveu:\n${citado}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#1e293b;line-height:1.6;white-space:pre-wrap">${esc(corpo)}</div>`
    + `<p style="font-family:Arial,Helvetica,sans-serif;color:#475569;font-size:13px;margin-top:18px">—<br>${esc(nome)}<br>BidPro Brasil</p>`
    + `<blockquote style="border-left:3px solid #cbd5e1;margin:16px 0 0;padding:4px 12px;color:#64748b;white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:13px">Em ${dataBR(orig.criado_em)}, ${esc(nome)} escreveu:\n${esc(String(orig.texto || '').slice(0, 2500))}</blockquote>`;
  if (seco) return { id: c.id, enviaria: n, para: orig.para, assunto };

  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const env = await enviarEmail({
    from: `${nome} (BidPro Brasil) <${orig.caixa}>`, to: orig.para, cc: orig.cc?.length ? orig.cc : undefined,
    replyTo: orig.caixa.replace('@', `+${token}@`), subject: assunto, html, text: texto,
    meta: { tipo: 'cobranca_posicao', userId: c.user_id }, idempotencyKey: `cobranca:${c.id}:${n}`,
    semFila: true, // 19/10: a fila não guarda remetente/fio/anexo — represado sairia por noreply@, fora do fio, e em dobro
  });
  if (!env?.ok) throw new Error(`envio: ${env?.error || 'sem confirmação'}`);
  // O e-mail JÁ SAIU. O registro é o que liga a resposta (+token) à cobrança — falha aqui grita, não some.
  const ins = await sb('email_caixa', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    direcao: 'saida', pasta: 'enviados', caixa: orig.caixa, de_email: orig.caixa, de_nome: nome, dono: c.user_id,
    para: orig.para, cc: orig.cc || [], assunto, texto, html, resend_email_id: env.id || null, lido: true,
    enviado_por: c.user_id, resposta_token: token, ...(orig.caso_id ? { caso_id: orig.caso_id } : {}),
  }) });
  const [reg] = ins.ok ? await ins.json().catch(() => []) : [];
  if (!reg?.id) console.error(`[email-cobranca] cobrança ${c.id} enviada mas NÃO registrada em email_caixa: HTTP ${ins.status} — a resposta a ela não vai parar a cobrança pelo token`);
  await atualizar(c.id, { enviadas: n, envios: reg?.id ? [...(c.envios || []), reg.id] : (c.envios || []),
    proxima_em: new Date(Date.now() + c.intervalo_dias * 864e5).toISOString() });
  return { id: c.id, enviada: n };
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const seco = new URL(req.url, BASE).searchParams.get('seco') === '1';
  const dia = new Date(Date.now() - 3 * 3600e3).getUTCDay(); // dia em Brasília
  if (!seco && (dia === 0 || dia === 6)) return new Response(JSON.stringify({ ok: true, pulado: 'fim de semana' }), { status: 200 });
  const res = { ok: true, seco, avaliadas: 0, enviadas: 0, respondidas: 0, limite: 0, falhas: [], detalhes: [] };
  let fila;
  try { fila = await ler(`email_cobranca?ativo=eq.true&proxima_em=lte.${encodeURIComponent(new Date().toISOString())}&select=*&order=proxima_em.asc&limit=${POR_RODADA}`); }
  catch (e) { console.error('[email-cobranca] fila:', e.message); return new Response(JSON.stringify({ ok: false, erro: e.message }), { status: 500 }); }
  for (const c of fila) {
    res.avaliadas++;
    try {
      const r = await processar(c, { seco });
      if (r.enviada) res.enviadas++;
      if (r.respondido) res.respondidas++;
      if (r.limite) res.limite++;
      res.detalhes.push(r);
    } catch (e) {
      // Falha de envio/rede: não encerra — a mesma data vale na próxima rodada (a idempotência evita duplicar).
      console.error('[email-cobranca]', c.id, e?.message);
      res.falhas.push({ id: c.id, erro: String(e?.message || e).slice(0, 200) });
    }
  }
  console.log('[email-cobranca]', JSON.stringify({ ...res, detalhes: undefined }));
  return new Response(JSON.stringify(res), { status: res.falhas.length ? 500 : 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
