import { getUser, getUserRoleById } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const role = await getUserRoleById(user.id);
  if (!['admin', 'analista'].includes(role)) return res.status(403).json({ error: 'Acesso negado' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/imoveis_leilao?select=id,atualizado_em&order=atualizado_em.desc&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'count=exact',
        },
      }
    );

    const count = parseInt(response.headers.get('content-range')?.split('/')[1] || '0', 10);
    const data = await response.json();
    const ultimaAtualizacao = data?.[0]?.atualizado_em || null;

    return res.status(200).json({
      total: count,
      ultima_atualizacao: ultimaAtualizacao,
    });
  } catch (e) {
    console.error('[scraper-status]', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
