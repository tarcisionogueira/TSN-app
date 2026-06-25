/**
 * POST /api/busca-raio
 * Busca imóveis dentro de um raio usando earthdistance (PostGIS-lite nativo do Postgres).
 * Retorna página com distância calculada no banco — sem trazer 5000 registros pro browser.
 *
 * Body: { lat, lng, raioKm, pagina, porPagina, filtros: { tipo, estado, modalidade, valorMin, valorMax } }
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400 }); }

  const { lat, lng, raioKm = 50, pagina = 1, porPagina = 24, filtros = {} } = body;

  if (!lat || !lng) return new Response(JSON.stringify({ error: 'lat e lng são obrigatórios' }), { status: 400 });

  const raioMetros = raioKm * 1000;
  const offset = (pagina - 1) * porPagina;

  // Monta filtros adicionais como query string RPC
  const params = new URLSearchParams({
    lat: lat,
    lng: lng,
    raio_metros: raioMetros,
    lim: porPagina,
    off: offset,
    tipo_filtro: filtros.tipo || '',
    estado_filtro: filtros.estado || '',
    modalidade_filtro: filtros.modalidade || '',
    valor_min: filtros.valorMin || 0,
    valor_max: filtros.valorMax || 9999999999,
  });

  // Chama função RPC que usa earthdistance
  const rpcRes = await sb(`rpc/buscar_por_raio?${params.toString()}`);

  if (!rpcRes.ok) {
    const err = await rpcRes.text().catch(() => '');
    // Se a função RPC não existe ainda, retorna erro claro
    if (err.includes('does not exist') || err.includes('function')) {
      return new Response(JSON.stringify({
        error: 'Função buscar_por_raio não existe no banco. Execute a migração SQL.',
        detalhes: err,
      }), { status: 503 });
    }
    return new Response(JSON.stringify({ error: 'Erro ao buscar por raio', detalhes: err }), { status: 500 });
  }

  const dados = await rpcRes.json();

  return new Response(JSON.stringify({
    resultados: dados || [],
    pagina,
    porPagina,
    total: dados?.length === porPagina ? null : (offset + (dados?.length || 0)), // total exato requer 2ª query de count
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
