// Endpoint de diagnóstico: verifica auth e conta imóveis pendentes de geocodificação
// Removível após debug. Acessível apenas por admin.
export const maxDuration = 30;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req) {
  const debug = { etapas: [], erro: null };

  // 1. Verifica env vars
  debug.etapas.push({ etapa: 'env', supabase_url: !!SUPABASE_URL, service_key: !!SUPABASE_SERVICE_KEY });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ ...debug, erro: 'Env vars ausentes' }, 500);
  }

  // 2. Extrai JWT do header
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  debug.etapas.push({ etapa: 'jwt', tem_token: !!token, token_inicio: token ? token.slice(0, 20) + '...' : null });
  if (!token) return json({ ...debug, erro: 'Sem token JWT' }, 401);

  // 3. Valida JWT via Supabase auth
  let userId = null;
  try {
    const authR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    const authStatus = authR.status;
    const authBody = await authR.json().catch(() => ({}));
    userId = authBody?.id || null;
    debug.etapas.push({ etapa: 'auth_user', status: authStatus, user_id: userId, email: authBody?.email });
    if (!authR.ok || !userId) return json({ ...debug, erro: `Auth falhou (status ${authStatus})` }, 401);
  } catch (e) {
    return json({ ...debug, erro: `Auth exception: ${e.message}` }, 500);
  }

  // 4. Busca perfil do usuário
  let role = null;
  try {
    const perfisR = await fetch(`${SUPABASE_URL}/rest/v1/perfis?select=role&id=eq.${userId}&limit=1`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    const perfisStatus = perfisR.status;
    const perfisBody = await perfisR.json().catch(() => []);
    role = perfisBody?.[0]?.role || null;
    debug.etapas.push({ etapa: 'perfil', status: perfisStatus, role, rows: perfisBody?.length });
    if (!perfisR.ok) return json({ ...debug, erro: `Perfil query falhou (status ${perfisStatus})` }, 500);
  } catch (e) {
    return json({ ...debug, erro: `Perfil exception: ${e.message}` }, 500);
  }

  if (role !== 'admin') return json({ ...debug, erro: `Role não é admin: ${role}` }, 403);
  debug.etapas.push({ etapa: 'auth_ok', role });

  // 5. Conta imóveis pendentes de geocodificação (latitude IS NULL ou = 0)
  try {
    const countR = await fetch(
      `${SUPABASE_URL}/rest/v1/imoveis_leilao?select=*&or=(latitude.is.null,latitude.eq.0)&ativo=eq.true`,
      {
        method: 'HEAD',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          Prefer: 'count=exact',
        },
      }
    );
    const countStatus = countR.status;
    const total = parseInt(countR.headers.get('content-range')?.split('/')[1] || '0', 10);
    debug.etapas.push({ etapa: 'count_pendentes', status: countStatus, total_pendentes: total, content_range: countR.headers.get('content-range') });
  } catch (e) {
    debug.etapas.push({ etapa: 'count_pendentes', erro: e.message });
  }

  // 6. Conta total de imóveis ativos
  try {
    const totalR = await fetch(
      `${SUPABASE_URL}/rest/v1/imoveis_leilao?select=*&ativo=eq.true`,
      {
        method: 'HEAD',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          Prefer: 'count=exact',
        },
      }
    );
    const total = parseInt(totalR.headers.get('content-range')?.split('/')[1] || '0', 10);
    debug.etapas.push({ etapa: 'count_total', status: totalR.status, total_ativos: total });
  } catch (e) {
    debug.etapas.push({ etapa: 'count_total', erro: e.message });
  }

  return json(debug, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
