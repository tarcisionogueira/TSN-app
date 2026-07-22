/**
 * GET/POST /api/retencao-avisos-cron — AVISA o cliente ANTES de qualquer limpeza
 * de documentos (Retenção Etapa 2). NÃO apaga nada: só identifica quem deve ser
 * avisado, envia e-mail + push e grava o aviso com a data-limite (apagar_em). A
 * deleção em si só acontece depois, no limpar-documentos-cron, e SOMENTE para
 * documentos que já têm aviso enviado + carência vencida (trava notify-first).
 *
 * Regras (do dono):
 *   • Regra 2 (não arrematado + 3 relatórios): avisa que precisa sinalizar o
 *     arremate; senão, os docs saem 15 dias após o 3º relatório (mín. 7d de carência).
 *   • Regra 1 (arrematado + assinatura em atraso): avisa; docs saem 30 dias após
 *     parar de pagar. Se regularizar/sinalizar, o aviso é revalidado e nada é apagado.
 *
 * SEGURANÇA / ROLLOUT: por padrão roda em DRY-RUN (só conta candidatos, sem enviar
 * nem gravar). Para ATIVAR os avisos de verdade, definir env RETENCAO_AVISOS_ATIVO=1.
 * Enquanto inativo, NADA é enviado ao cliente e NENHUM documento fica elegível a
 * deleção (a RPC de deleção exige aviso com email_enviado=true).
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { enviarWebPush } from './_webpush.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_URL      = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const EMAIL_FROM   = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';
const ATIVO        = process.env.RETENCAO_AVISOS_ATIVO === '1';
const VAPID = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: 'mailto:alertas@bidprobrasil.com.br' };

const CARENCIA_MIN_DIAS = 7;   // piso de carência entre o aviso e a deleção
const DIA = 86400000;
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtData = iso => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' });

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
}

async function emailDoUsuario(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.email ? String(u.email) : null;
  } catch { return null; }
}

function corpoEmail({ regra, titulo, dataFmt }) {
  const imovel = titulo ? `<strong>${esc(titulo)}</strong>` : 'um imóvel que você analisou';
  if (regra === 'r1_inadimplente') {
    return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <p style="font-size:15px">Olá!</p>
      <p style="font-size:14px;line-height:1.7">Identificamos que sua assinatura na BidPro Brasil está <strong>em atraso</strong>.
      Os documentos do imóvel arrematado ${imovel} ficam guardados enquanto sua assinatura está ativa.</p>
      <p style="font-size:14px;line-height:1.7">Para <strong>não perder esses documentos</strong>, regularize o pagamento
      até <strong>${esc(dataFmt)}</strong>. Após essa data, os arquivos podem ser removidos do seu portal.</p>
      <p style="font-size:14px;line-height:1.7"><a href="${APP_URL}/#/planos" style="color:#0D63DB"><strong>Regularizar minha assinatura</strong></a></p>
      <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil · aviso de retenção de documentos.</p>
    </div>`;
  }
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <p style="font-size:15px">Olá!</p>
    <p style="font-size:14px;line-height:1.7">Você concluiu os <strong>3 relatórios</strong> do imóvel ${imovel}. Para manter
    os documentos guardados no seu portal, confirme se você <strong>arrematou</strong> este imóvel.</p>
    <p style="font-size:14px;line-height:1.7">É simples: abra <a href="${APP_URL}/#/analises" style="color:#0D63DB"><strong>Minhas Análises</strong></a>
    e clique em <strong>“Arrematei este imóvel”</strong>. Assim guardamos os documentos do seu arremate.</p>
    <p style="font-size:13px;line-height:1.7;color:#475569">Se você <strong>não arrematou</strong>, não precisa fazer nada — os
    documentos deste imóvel serão removidos a partir de <strong>${esc(dataFmt)}</strong> para liberar espaço. Eles podem ser
    gerados novamente a qualquer momento pela plataforma.</p>
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil · aviso de retenção de documentos.</p>
  </div>`;
}

async function enviarPush(userId, regra, titulo) {
  if (!VAPID.publicKey || !VAPID.privateKey) return false;
  try {
    const r = await sb(`push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=endpoint,p256dh,auth`);
    const subs = await r.json().catch(() => []);
    if (!Array.isArray(subs) || !subs.length) return false;
    const payload = {
      title: regra === 'r1_inadimplente' ? 'Regularize para manter seus documentos' : 'Confirme seu arremate',
      body: regra === 'r1_inadimplente'
        ? 'Sua assinatura está em atraso — regularize para não perder os documentos do imóvel arrematado.'
        : 'Você concluiu os 3 relatórios. Sinalize o arremate para guardar os documentos.',
      url: regra === 'r1_inadimplente' ? '/planos' : '/analises',
      tag: 'retencao-aviso', icon: '/logo.svg',
    };
    const res = await Promise.all(subs.map(s => enviarWebPush(s, payload, VAPID).catch(() => ({ ok: false }))));
    return res.some(x => x && x.ok !== false && x.status !== 410 && x.status !== 404);
  } catch { return false; }
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });

  // Candidatos (a RPC não apaga nada; só identifica quem avisar).
  const candRes = await sb('rpc/retencao_candidatos_aviso', { method: 'POST', body: '{}' });
  if (!candRes.ok) return new Response(JSON.stringify({ error: 'RPC falhou', detalhe: await candRes.text().catch(() => '') }), { status: 500 });
  const candidatos = await candRes.json().catch(() => []);

  const resumo = { ativo: ATIVO, candidatos: candidatos.length, r2: 0, r1: 0, avisos_novos: 0, emails_enviados: 0, push_enviados: 0, ja_avisados: 0 };

  for (const c of (Array.isArray(candidatos) ? candidatos : [])) {
    if (c.regra === 'r1_inadimplente') resumo.r1++; else resumo.r2++;

    if (!ATIVO) continue; // DRY-RUN: só conta

    // Já existe aviso deste imóvel+regra?
    const exRes = await sb(`doc_retencao_aviso?select=id,email_enviado,cancelado_em&imovel_id=eq.${c.imovel_id}&regra=eq.${c.regra}&limit=1`);
    const ex = await exRes.json().catch(() => []);
    let row = Array.isArray(ex) && ex.length ? ex[0] : null;

    if (row && (row.cancelado_em || row.email_enviado)) { resumo.ja_avisados++; continue; }

    if (!row) {
      // apagar_em = o maior entre a regra (15d/30d) e o piso de carência (agora + 7d)
      const apagarEm = new Date(Math.max(Date.parse(c.apagar_em) || 0, Date.now() + CARENCIA_MIN_DIAS * DIA)).toISOString();
      const insRes = await sb('doc_retencao_aviso', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ imovel_id: c.imovel_id, user_id: c.user_id, regra: c.regra, apagar_em: apagarEm, motivo: c.titulo || null }),
      });
      const ins = await insRes.json().catch(() => []);
      row = Array.isArray(ins) && ins.length ? ins[0] : null;
      if (row) resumo.avisos_novos++;
      else continue; // corrida/conflito → tenta no próximo run
    }

    // Envia e-mail + push e marca como enviado (só marca deleção-elegível quem foi avisado).
    const dataFmt = fmtData(row.apagar_em || c.apagar_em);
    let emailOk = false, pushOk = false;

    const email = c.user_id ? await emailDoUsuario(c.user_id) : null;
    if (email) {
      try {
        await enviarEmail({
          from: EMAIL_FROM, to: email,
          subject: c.regra === 'r1_inadimplente'
            ? 'Regularize sua assinatura para manter seus documentos'
            : 'Confirme seu arremate para guardar os documentos',
          html: corpoEmail({ regra: c.regra, titulo: c.titulo, dataFmt }),
        });
        emailOk = true; resumo.emails_enviados++;
      } catch (e) { console.error('[retencao-avisos] email:', e?.message); }
    }
    pushOk = await enviarPush(c.user_id, c.regra, c.titulo);
    if (pushOk) resumo.push_enviados++;

    await sb(`doc_retencao_aviso?id=eq.${row.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ email_enviado: emailOk, push_enviado: pushOk, avisado_em: new Date().toISOString() }),
    });
  }

  return new Response(JSON.stringify({ ok: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });
}
