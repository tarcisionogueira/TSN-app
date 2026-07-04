// Endpoint chamado pelos GitHub Actions em caso de falha de workflow
// POST { tipo, etapa, run_id, run_url, mensagem }
export const config = { runtime: 'edge' };

const RESEND_KEY  = process.env.RESEND_API_KEY;
const FROM_EMAIL  = process.env.APP_FROM_EMAIL  || 'noreply@bidprobrasil.com.br';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL      || 'tarcisioaraujo@reimob.com.br';
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL     = process.env.APP_BASE_URL     || 'https://bidprobrasil.com.br';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { isCronAuthorized } = await import('./_auth.js');
  if (!isCronAuthorized(req)) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const { tipo = 'Scraper', etapa = '', run_id = '', run_url = '', mensagem = '' } = body;
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  if (RESEND_KEY) {
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#dc2626;color:white;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">🔴 Falha de Scraper — ${tipo}</h2>
          <p style="margin:8px 0 0;opacity:.9">${agora} (BRT)</p>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px">
          ${etapa ? `<p><strong>Etapa:</strong> ${etapa}</p>` : ''}
          ${mensagem ? `<p><strong>Detalhe:</strong> ${mensagem}</p>` : ''}
          ${run_id ? `<p><strong>Run ID:</strong> ${run_id}</p>` : ''}
          <div style="margin-top:16px;display:flex;gap:12px">
            ${run_url ? `<a href="${run_url}" style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Ver log no GitHub →</a>` : ''}
            <a href="${APP_URL}/#/admin" style="display:inline-block;background:#0D63DB;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Abrir Admin →</a>
          </div>
        </div>
      </div>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject: `🔴 BidPro — Falha: ${tipo}${etapa ? ' / ' + etapa : ''}`,
        html,
      }),
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
