import { alertarErro } from './_error-alert.js';
import { isCronAuthorized } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;
  const FROM         = process.env.APP_FROM_EMAIL || 'TSN Ativos <alertas@tsnativos.com.br>';
  const BASE_URL     = process.env.APP_BASE_URL   || 'https://bidprobrasil.com.br';

  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Busca financiamentos com vencimento HOJE (sinal ou parcela calculada)
  // Estratégia: busca todos ativos e filtra em JS (Supabase REST não suporta date_add)
  const finRes = await fetch(
    `${SUPABASE_URL}/rest/v1/financiamentos?notificar_email=eq.true&select=*`,
    { headers: hdr }
  );
  const fins = await finRes.json();

  let enviados = 0;
  const erros = [];

  for (const fin of fins || []) {
    try {
      const vencimentos = [];

      // Verifica sinal
      if (fin.data_sinal === hoje && !fin.notificado_sinal) {
        vencimentos.push({ tipo: 'Sinal', valor: fin.valor_sinal, data: hoje, parcela: null });
      }

      // Verifica parcelas baseadas em data_primeira_parcela + N meses
      if (fin.data_primeira_parcela && fin.num_parcelas && fin.valor_parcela) {
        const base = new Date(fin.data_primeira_parcela);
        for (let i = 0; i < fin.num_parcelas; i++) {
          const dt = new Date(base);
          dt.setMonth(dt.getMonth() + i);
          const dtStr = dt.toISOString().slice(0, 10);
          if (dtStr === hoje) {
            vencimentos.push({ tipo: 'Parcela', valor: fin.valor_parcela, data: hoje, parcela: i + 1 });
          }
        }
      }

      if (vencimentos.length === 0) continue;
      if (!RESEND_KEY) continue;

      // Busca email do usuário via auth.users (requer service role)
      const userRes = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users/${fin.user_id}`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      if (!userRes.ok) continue;
      const userData = await userRes.json();
      const email = userData?.email;
      if (!email) continue;

      const fmtBRL = v => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—';
      const fmtData = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

      const linhasHtml = vencimentos.map(v =>
        `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:14px 18px;margin-bottom:10px;">
          <div style="font-size:13px;color:#78350f;font-weight:700;">
            ⚠️ ${v.tipo === 'Sinal' ? 'Sinal de entrada' : `Parcela ${v.parcela}/${fin.num_parcelas}`} vence hoje
          </div>
          <div style="font-size:22px;font-weight:800;color:#0f172a;margin:8px 0;">${fmtBRL(v.valor)}</div>
          <div style="font-size:12px;color:#64748b;">${fin.imovel_nome || 'Imóvel'} · ${fmtData(v.data)}</div>
        </div>`
      ).join('');

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:22px 28px;text-align:center;">
    <div style="font-size:20px;font-weight:800;color:#fff;">TSN Ativos</div>
    <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Lembrete de vencimento</div>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
      Você tem ${vencimentos.length > 1 ? 'pagamentos' : 'um pagamento'} vencendo <strong>hoje</strong>:
    </p>
    ${linhasHtml}
    <div style="text-align:center;margin-top:20px;">
      <a href="${BASE_URL}/#/perfil" style="display:inline-block;background:#0D63DB;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:700;font-size:14px;">
        Ver meus financiamentos →
      </a>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:20px;">
      TSN Ativos · Este lembrete foi configurado por você na plataforma.
    </p>
  </div>
</div>
</body>
</html>`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: email,
          subject: `⚠️ Vencimento hoje — ${fin.imovel_nome || 'Financiamento'}`,
          html,
        }),
      });

      if (emailRes.ok) {
        // Marca sinal como notificado se aplicável
        const hasSinal = vencimentos.some(v => v.tipo === 'Sinal');
        if (hasSinal) {
          await fetch(`${SUPABASE_URL}/rest/v1/financiamentos?id=eq.${fin.id}`, {
            method: 'PATCH',
            headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ notificado_sinal: true }),
          });
        }
        enviados++;
      }
    } catch (e) {
      console.error('[financiamento-alertas]', e.message);
      erros.push(fin.id);
    }
  }

  if (erros.length > 0) {
    await alertarErro('[financiamento-alertas-cron]', `${erros.length} financiamentos com erro`, { ids: erros });
  }

  return res.status(200).json({ ok: true, enviados, total: fins?.length || 0, erros: erros.length });
}
