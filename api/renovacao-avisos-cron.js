/**
 * /api/renovacao-avisos-cron — aviso por e-mail ANTES da renovação da assinatura.
 *
 * Varre os preapprovals AUTORIZADOS no Mercado Pago (assinaturas recorrentes) e,
 * ~3 dias antes da próxima cobrança (next_payment_date), envia ao cliente um
 * e-mail com o descritivo completo: plano, valor, data e forma de pagamento
 * (cobrança recorrente automática no cartão). Idempotente por ciclo de cobrança
 * (webhook_eventos_processados: evento 'renov_aviso:<data>') — não reenvia.
 *
 * OBS: o plano ANUAL (top2_anual) hoje é pagamento ÚNICO (não é preapproval),
 * portanto NÃO aparece aqui nem auto-renova. Habilitar renovação anual exige um
 * mecanismo de recobrança anual à parte — ver docs/PENDENCIAS_PAGAMENTOS.md.
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';

const MP_TOKEN     = (process.env.MP_ACCESS_TOKEN || '').trim();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_URL      = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const EMAIL_FROM   = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const fmtBRL = v => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Idempotência: o INSERT é a trava (PK única em webhook_eventos_processados).
// 201 = inseriu agora (primeira vez) → avisar; 409 = já avisado neste ciclo → pular.
async function jaAvisado(preapprovalId, nextDate) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/webhook_eventos_processados`, {
      method: 'POST',
      headers: { ...hdr, Prefer: 'return=minimal' },
      body: JSON.stringify({ gateway: 'mercadopago', gateway_payment_id: String(preapprovalId), evento: `renov_aviso:${nextDate}` }),
    });
    if (r.status === 201 || r.ok) return false;
    if (r.status === 409) return true;
    return true; // erro inesperado → não arriscar spam
  } catch { return true; }
}

function corpoEmail({ nome, plano, valor, dataFmt }) {
  const saud = nome ? `Olá, ${esc(nome.split(' ')[0])}!` : 'Olá!';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <p style="font-size:15px">${saud}</p>
    <p style="font-size:14px;line-height:1.7">Sua assinatura <strong>${esc(plano)}</strong> na BidPro Brasil
    <strong>renova automaticamente em ${esc(dataFmt)}</strong>. <strong>Você não precisa fazer nada para continuar</strong> —
    é só um aviso de transparência com os detalhes:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:8px 0;color:#64748b">Plano</td><td style="padding:8px 0;text-align:right;font-weight:700">${esc(plano)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;border-top:1px solid #e2e8f0">Valor</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">${fmtBRL(valor)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;border-top:1px solid #e2e8f0">Data da cobrança</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">${esc(dataFmt)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;border-top:1px solid #e2e8f0">Forma de pagamento</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">Cobrança recorrente automática no cartão cadastrado</td></tr>
    </table>
    <p style="font-size:13px;line-height:1.7;color:#475569">Se você <strong>não quiser renovar</strong>, é só
    <a href="${APP_URL}/#/perfil" style="color:#0D63DB"><strong>acessar o portal e cancelar a renovação automática</strong></a>
    até <strong>${esc(dataFmt)}</strong> — imediato, sem multa. Por lá também dá para trocar o cartão. Se estiver tudo certo, não precisa responder.</p>
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil · aviso de renovação (você não precisa confirmar nada para continuar).</p>
  </div>`;
}

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!MP_TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN ausente' }), { status: 500 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });

  const AGORA = Date.now();
  const DIA = 86400000;
  let verificados = 0, avisados = 0;

  try {
    for (let offset = 0; offset < 3000; offset += 100) {
      const r = await fetch(`https://api.mercadopago.com/preapproval/search?status=authorized&offset=${offset}&limit=100`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      if (!r.ok) break;
      const data = await r.json();
      const results = data?.results || [];
      if (!results.length) break;

      for (const sub of results) {
        verificados++;
        const nextRaw = sub.next_payment_date || sub.auto_recurring?.next_payment_date;
        if (!nextRaw) continue;
        const nextMs = Date.parse(nextRaw);
        if (isNaN(nextMs)) continue;
        const dias = Math.ceil((nextMs - AGORA) / DIA);
        if (dias < 1 || dias > 3) continue;          // avisa ~3 dias antes
        const email = sub.payer_email;
        if (!email) continue;

        const nextDate = String(nextRaw).slice(0, 10);
        if (await jaAvisado(sub.id, nextDate)) continue;

        const valor  = sub.auto_recurring?.transaction_amount;
        const plano  = sub.reason || 'BidPro Brasil';
        const nome   = sub.payer_first_name || sub.payer_name || '';
        const dataFmt = new Date(nextMs).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' });

        try {
          await enviarEmail({
            from: EMAIL_FROM,
            to: email,
            subject: `Sua assinatura ${plano} renova em ${dataFmt}`,
            html: corpoEmail({ nome, plano, valor, dataFmt }),
          });
          avisados++;
        } catch (e) { console.error('[renovacao-avisos] email:', e?.message); }
      }

      const total = Number(data?.paging?.total || 0);
      if (offset + 100 >= total) break;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, verificados, avisados }), { headers: { 'Content-Type': 'application/json' } });
}
