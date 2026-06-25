/**
 * GET /api/mp-saque-cron
 * Cron toda sexta-feira às 9h (0 9 * * 5):
 * - Agrega saques pendentes
 * - Envia email ao admin com resumo para processar os pagamentos
 */

export const config = { runtime: 'edge' };

import { isCronAuthorized } from './_auth.js';

const SUPABASE    = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const FROM        = process.env.APP_FROM_EMAIL || 'TSN App <alertas@bidprobrasil.com.br>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tarcisioaraujo@reimob.com.br';
const BASE_URL    = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });

  // Busca saques pendentes
  const res = await fetch(`${SUPABASE}/rest/v1/mp_saques?status=eq.pendente&order=solicitado_em.asc`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const saques = await res.json();

  if (!saques?.length) return new Response(JSON.stringify({ ok: true, pendentes: 0 }), { status: 200 });

  const total = saques.reduce((s, r) => s + Number(r.valor), 0);
  const fmtBRL = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  const linhas = saques.map(s => `
    <tr style="border-bottom:1px solid #e2e8f0">
      <td style="padding:10px 12px;font-weight:700">${s.nome_solicitante}</td>
      <td style="padding:10px 12px;color:#64748b">${s.role}</td>
      <td style="padding:10px 12px;text-align:right;font-weight:700;color:#059669">${fmtBRL(s.valor)}</td>
      <td style="padding:10px 12px;color:#64748b;font-size:12px">${s.chave_pix || `${s.banco} Ag.${s.agencia} C.${s.conta}`}</td>
      <td style="padding:10px 12px;color:#94a3b8;font-size:11px">${new Date(s.solicitado_em).toLocaleDateString('pt-BR')}</td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<style>body{font-family:-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px}
.card{background:white;border-radius:12px;padding:28px 32px;max-width:680px;margin:0 auto;border:1px solid #e2e8f0}
h2{color:#111;margin:0 0 6px;font-size:20px}table{width:100%;border-collapse:collapse;margin-top:20px}
th{text-align:left;padding:10px 12px;background:#f1f5f9;font-size:12px;color:#64748b;font-weight:700}
.total{background:#f0fdf4;border-radius:8px;padding:14px 16px;margin-top:16px;font-size:16px;font-weight:700;color:#059669}
.btn{display:inline-block;margin-top:20px;padding:12px 28px;background:#0D63DB;color:white;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px}
</style></head><body>
<div class="card">
  <h2>💸 Resumo de Saques — Sexta-feira</h2>
  <p style="color:#64748b;font-size:14px;margin:0 0 4px">${saques.length} solicitação(ões) pendente(s) para processar hoje.</p>
  <table>
    <thead><tr>
      <th>Profissional</th><th>Role</th><th style="text-align:right">Valor</th><th>PIX / Banco</th><th>Solicitado em</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
  </table>
  <div class="total">Total a transferir: ${fmtBRL(total)}</div>
  <a href="${BASE_URL}/#/admin?tab=saques" class="btn">Aprovar saques no Admin →</a>
  <p style="margin-top:24px;font-size:11px;color:#94a3b8">
    Processe as transferências no app do Mercado Pago e marque como "Pago" no painel.
    Após processar, o saldo retorna ao CDI automaticamente no próximo ciclo.
  </p>
</div></body></html>`;

  if (RESEND_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: ADMIN_EMAIL,
        subject: `💸 ${saques.length} saque(s) pendente(s) — ${fmtBRL(total)} para processar hoje`,
        html,
      }),
    });
  }

  return new Response(JSON.stringify({ ok: true, pendentes: saques.length, total }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
