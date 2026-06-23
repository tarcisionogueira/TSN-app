export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('ok', { status: 200 });

  const secret = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) return new Response('unauthorized', { status: 401 });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return new Response(JSON.stringify({ error: 'env not configured' }), { status: 500 });

  const alertasRes = await fetch(`${supabaseUrl}/rest/v1/alertas_email?select=*,perfis(email,nome)&ativo=eq.true&or=(ultimo_envio.is.null,ultimo_envio.lt.${new Date(Date.now() - 7*24*60*60*1000).toISOString()})`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });

  const alertas = await alertasRes.json();
  let enviados = 0;

  for (const alerta of alertas || []) {
    try {
      const filtros = alerta.filtros || {};
      let url = `${supabaseUrl}/rest/v1/imoveis_leilao?select=*&ativo=eq.true&order=desconto_percentual.desc&limit=5`;
      if (filtros.estado) url += `&estado=eq.${filtros.estado}`;
      if (filtros.tipo) url += `&tipo=ilike.*${filtros.tipo}*`;

      const imoveisRes = await fetch(url, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
      });
      const imoveis = await imoveisRes.json();

      if (imoveis?.length > 0) {
        const userEmail = alerta.perfis?.email;
        const userName = alerta.perfis?.nome;
        if (!userEmail) continue;

        // Check if user has enough search activity
        const activityRes = await fetch(
          `${supabaseUrl}/rest/v1/busca_historico?user_id=eq.${alerta.user_id}&criado_em=gte.${new Date(Date.now()-30*24*60*60*1000).toISOString()}&select=id`,
          { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
        );
        const activity = await activityRes.json();
        // Only send if user has searched at least 3 times in last 30 days, or it's the first email
        if ((activity?.length || 0) < 3 && (alerta.total_enviados || 0) > 0) continue;

        // Envia diretamente via Resend (cron não tem token de usuário para autenticar /api/email-alerta)
        const RESEND_KEY = process.env.RESEND_API_KEY;
        if (!RESEND_KEY) continue;
        const FROM = process.env.APP_FROM_EMAIL || 'TSN Ativos <alertas@tsnativos.com.br>';
        const BASE_URL = process.env.APP_BASE_URL || new URL(req.url).origin;
        const unsubToken = btoa(`${alerta.user_id}:unsubscribe`);
        const unsubUrl = `${BASE_URL}/cancelar-alertas?token=${unsubToken}`;
        const imoveisHtml = imoveis.slice(0, 5).map(im =>
          `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;">
            <strong>${im.endereco || im.titulo || 'Imóvel'}</strong><br>
            <span style="color:#64748b;font-size:13px;">${im.cidade || ''}${im.estado ? ' — ' + im.estado : ''}</span><br>
            ${im.desconto_percentual ? `<span style="color:#059669;font-weight:700;">${im.desconto_percentual}% abaixo do valor de avaliação</span>` : ''}
          </div>`
        ).join('');
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: userEmail,
            subject: `${imoveis.length} imóveis novos para você — TSN Ativos`,
            html: `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:24px 16px;">
              <h2 style="color:#0f172a;">Olá${userName ? ', ' + userName : ''}!</h2>
              <p style="color:#475569;">Encontramos imóveis que correspondem ao seu alerta <strong>${alerta.descricao || ''}</strong>:</p>
              ${imoveisHtml}
              <p style="margin-top:20px;"><a href="${BASE_URL}" style="background:#0D63DB;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Ver todos os imóveis</a></p>
              <p style="font-size:12px;color:#94a3b8;margin-top:24px;"><a href="${unsubUrl}" style="color:#94a3b8;">Cancelar alertas</a></p>
            </div>`,
          }),
        });

        await fetch(`${supabaseUrl}/rest/v1/alertas_email?id=eq.${alerta.id}`, {
          method: 'PATCH',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ ultimo_envio: new Date().toISOString(), total_enviados: (alerta.total_enviados || 0) + 1 }),
        });
        enviados++;
      }
    } catch (_) {}
  }

  return new Response(JSON.stringify({ ok: true, enviados, total: alertas?.length || 0 }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
