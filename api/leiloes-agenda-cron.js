/**
 * GET /api/leiloes-agenda-cron — lembrete do leilão que está chegando (26/11, pedido do dono).
 *
 * "O William selecionou alguns imóveis para dias à frente; depois de aprovado no sistema, é para
 * cair no calendário e ser notificado por e-mail sobre o leilão que está chegando, no dia anterior
 * e no dia." A agenda é a MESMA do calendário da tela de Assessorados (api/_agenda-leiloes.js):
 * oportunidade aprovada pelo cliente + caso contratado sem arremate, uma entrada por praça.
 *
 * Duas etapas, por DIA DE CALENDÁRIO no fuso de Brasília (não por horas — ver live-lembrete-cron):
 *   vespera — o leilão é amanhã.
 *   dia     — o leilão é hoje (e, com hora conhecida, ainda não começou).
 * Para: o cliente. Cópia oculta: a equipe designada a ele + os administradores (o dono acompanha).
 * Sem e-mail do cliente, vai só para a equipe — o aviso interno não depende do cadastro dele.
 *
 * Dedup: INSERT em webhook_eventos_processados (gateway 'agenda_leilao') é a trava; envio que
 * falha LIBERA a trava para a próxima rodada tentar de novo. Roda 2×/manhã (vercel.json): a
 * segunda rodada cobre a primeira se ela cair, e o dedup faz dela um no-op quando deu certo.
 *
 * `?seco=1` monta tudo e devolve a prévia SEM enviar e SEM travar — para conferir em dado real.
 * Gate: CRON_SECRET. Custo: só e-mail transacional (Resend), sem IA e sem coleta.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { montarAgenda, diasAte, TZ } from './_agenda-leiloes.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${path.split('?')[0]}`);
  return r.json();
}

const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const cacheEmail = new Map();
async function emailDe(userId) {
  if (cacheEmail.has(userId)) return cacheEmail.get(userId);
  let em = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
    if (r.ok) { const u = await r.json(); em = RE_EMAIL.test(String(u?.email || '')) ? String(u.email).toLowerCase() : null; }
    else console.error(`[agenda-leilao] e-mail de ${userId}: HTTP ${r.status}`);
  } catch (e) { console.error('[agenda-leilao] e-mail falhou:', e?.message); }
  cacheEmail.set(userId, em);
  return em;
}

async function travar(clienteId, evento) {
  try {
    const r = await sb('webhook_eventos_processados', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ gateway: 'agenda_leilao', gateway_payment_id: clienteId, evento }) });
    if (r.ok) return true;
    if (r.status !== 409) console.error(`[agenda-leilao] trava ${evento}: HTTP ${r.status}`);
    return false; // 409 = já enviado; outro erro = não arrisca duplicar
  } catch (e) { console.error('[agenda-leilao] trava falhou (não envia):', e?.message); return false; }
}
async function liberar(clienteId, evento) {
  const r = await sb(`webhook_eventos_processados?gateway=eq.agenda_leilao&gateway_payment_id=eq.${clienteId}&evento=eq.${encodeURIComponent(evento)}`, { method: 'DELETE' })
    .catch((e) => ({ ok: false, status: e?.message }));
  if (!r.ok) console.error('[agenda-leilao] liberar trava falhou:', r.status);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function etapaDe(ev, agora = Date.now()) {
  const d = diasAte(agora, ev.dia);
  if (d === 1) return 'vespera';
  if (d === 0 && (!ev.hora_conhecida || Date.parse(ev.quando) > agora)) return 'dia';
  return null;
}

// Formato de CARTA (CLAUDE.md, 26/10): saudação, parágrafos curtos, fecho e assinatura.
export function montarEmail(ev, etapa, nomeCliente) {
  const primeiro = String(nomeCliente || '').trim().split(/\s+/)[0] || '';
  const [a, m, d] = ev.dia.split('-').map(Number);
  const dataExt = new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long' });
  const hora = ev.hora_conhecida ? new Date(ev.quando).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : null;
  const quando = etapa === 'vespera' ? 'amanhã' : 'hoje';
  const praca = ev.praca ? ` (${ev.praca}ª praça)` : ''; // "o leilão (2ª praça) do imóvel…"
  const local = ev.cidade ? ` — ${ev.cidade}${ev.uf ? `/${ev.uf}` : ''}` : '';
  const origem = ev.origem === 'aprovada' ? 'que você aprovou' : 'que estamos acompanhando com você';

  const paragrafos = [
    primeiro ? `Olá, ${primeiro}!` : 'Olá!',
    `Passando para lembrar: o leilão${praca} do imóvel ${origem} é ${quando}, ${dataExt}${hora ? `, às ${hora}, horário de Brasília` : '. O horário exato está na página do lote'}.`,
    `Imóvel: ${ev.titulo}${local}.` + (ev.lance_minimo ? ` Lance mínimo: ${brl(ev.lance_minimo)}.` : '') + (ev.avaliacao ? ` Avaliação: ${brl(ev.avaliacao)}.` : ''),
    ev.url_lote ? `Página do lote: ${ev.url_lote}` : null,
    `Acompanhe pelo app em ${BASE}/arrematados. Qualquer dúvida antes do leilão, é só responder este e-mail.`,
    'Atenciosamente,',
    'Tarcísio Nogueira\nBidPro Brasil',
  ].filter(Boolean);

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;font-size:14px;line-height:1.7">
    ${paragrafos.map((p) => {
      const t = esc(p).replace(/\n/g, '<br>');
      return ev.url_lote && p.startsWith('Página do lote')
        ? `<p>Página do lote: <a href="${esc(ev.url_lote)}">abrir o lote</a></p>`
        : `<p>${t}</p>`;
    }).join('\n')}
  </div>`;
  const assunto = etapa === 'vespera'
    ? `Leilão amanhã${hora ? ` às ${hora}` : ''}: ${ev.titulo}`
    : `Leilão hoje${hora ? ` às ${hora}` : ''}: ${ev.titulo}`;
  return { subject: assunto.slice(0, 180), html, text: paragrafos.join('\n\n') };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'nao_autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'config ausente' });
  const seco = String(req.query?.seco || '') === '1';
  const agora = Date.now();
  const out = { seco, eventos: 0, a_enviar: 0, enviados: 0, ja_enviados: 0, sem_destinatario: 0, falhas: [], previa: [] };

  let agenda, admins, designacoes;
  try {
    agenda = await montarAgenda(ler, { desdeDias: 0, agora });
    admins = await ler('perfis?role=eq.admin&select=id');
    const cli = [...new Set(agenda.map((e) => e.cliente_id))];
    designacoes = cli.length ? await ler(`assessorado_designacao?cliente_id=in.(${cli.join(',')})&select=cliente_id,membro_id`) : [];
  } catch (e) {
    // Leitura que falhou NÃO é "nenhum leilão": o cron acusa (502) em vez de sair verde.
    console.error('[agenda-leilao] leitura falhou:', e.message);
    return res.status(502).json({ ok: false, motivo: e.message });
  }
  out.eventos = agenda.length;
  const adminEmails = (await Promise.all(admins.map((a) => emailDe(a.id)))).filter(Boolean);

  for (const ev of agenda) {
    const etapa = etapaDe(ev, agora);
    if (!etapa) continue;
    out.a_enviar++;
    const chave = `${ev.imovel_id}|${ev.praca || 1}|${ev.dia}|${etapa}`;
    const cliEmail = await emailDe(ev.cliente_id);
    const equipe = (await Promise.all(designacoes.filter((d) => d.cliente_id === ev.cliente_id).map((d) => emailDe(d.membro_id)))).filter(Boolean);
    const internos = [...new Set([...equipe, ...adminEmails])].filter((e) => e !== cliEmail);
    const to = cliEmail ? [cliEmail] : internos.slice(0, 1);
    const bcc = cliEmail ? internos : internos.slice(1);
    if (!to.length) { out.sem_destinatario++; continue; }
    const email = montarEmail(ev, etapa, ev.cliente_nome);

    if (seco) { out.previa.push({ chave, etapa, cliente: ev.cliente_nome, to, bcc, subject: email.subject }); continue; }
    if (!(await travar(ev.cliente_id, chave))) { out.ja_enviados++; continue; }
    const r = await enviarEmail({ to, bcc: bcc.length ? bcc : undefined, subject: email.subject, html: email.html, text: email.text,
      meta: { tipo: 'lembrete_leilao', userId: ev.cliente_id }, idempotencyKey: `agenda-leilao-${ev.cliente_id}-${chave.replace(/\|/g, "-")}` });
    if (r?.ok || r?.enfileirado) out.enviados++;
    else { out.falhas.push({ chave, erro: r?.error || 'desconhecido' }); await liberar(ev.cliente_id, chave); }
  }

  const ok = out.falhas.length === 0;
  console.log('[agenda-leilao]', JSON.stringify({ ...out, previa: out.previa.length }));
  return res.status(ok ? 200 : 502).json({ ok, ...out });
}
