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

  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const rpc = async (nome, body = '{}') => {
    try { const r = await fetch(`${supabaseUrl}/rest/v1/rpc/${nome}`, { method: 'POST', headers: h, body }); return r.ok ? await r.json() : null; }
    catch { return null; }
  };

  try {
    // Estatísticas do acervo + cobertura por fonte em 2 RPCs no SERVIDOR (service role,
    // sem RLS/timeout) — substitui os ~17 counts que a tela fazia no cliente e estouravam
    // (mostrando 0% geocode). Números REAIS: ativos, geocodificados, cobertura de docs.
    const [stats, cobertura] = await Promise.all([rpc('acervo_stats'), rpc('fonte_cobertura')]);

    const porFonte = {};
    for (const r of (Array.isArray(cobertura) ? cobertura : [])) porFonte[r.fonte] = r;

    return res.status(200).json({
      total: stats?.total ?? 0,
      ativos: stats?.ativos ?? null,
      geocod: stats?.geocod ?? null,
      sem_geo: stats?.sem_geo ?? null,
      ultima_atualizacao: stats?.ultima_atualizacao ?? null,
      por_fonte: porFonte,
    });
  } catch (e) {
    console.error('[scraper-status]', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
