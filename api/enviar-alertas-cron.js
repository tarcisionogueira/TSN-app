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

        const host = new URL(req.url).origin;
        await fetch(`${host}/api/email-alerta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: alerta.user_id, userEmail, userName, imoveis: imoveis.slice(0, 5), filtroDesc: alerta.descricao }),
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
