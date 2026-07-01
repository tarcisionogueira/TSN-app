/**
 * POST /api/busca-raio
 * Busca imóveis dentro de um raio usando earthdistance (PostGIS-lite nativo do Postgres).
 * Retorna página com distância calculada no banco — sem trazer 5000 registros pro browser.
 *
 * Body: { lat, lng, raioKm, pagina, porPagina, filtros: { tipos[], estado, modalidades[], pagamento[], valorMin, valorMax } }
 * pagamento usa valores canônicos do banco (a_vista | financiado | hipotecado).
 */
// Runtime EDGE: o handler usa a Web Request/Response (req.json() e `new Response`).
// SEM esta linha a função rodava no Node, onde o `return new Response()` é IGNORADO
// → a requisição pendurava e a busca por raio ficava em "Buscando..." pra sempre.
export const config = { runtime: 'edge' };

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

  // Aceita arrays (tipos/modalidades/pagamento) e mantém retrocompatibilidade com
  // os campos singulares antigos (tipo/modalidade).
  const tipos = Array.isArray(filtros.tipos) ? filtros.tipos.filter(Boolean)
    : (filtros.tipo ? [filtros.tipo] : []);
  const modalidades = Array.isArray(filtros.modalidades) ? filtros.modalidades.filter(Boolean)
    : (filtros.modalidade ? [filtros.modalidade] : []);
  const pagamentos = Array.isArray(filtros.pagamento) ? filtros.pagamento.filter(Boolean) : [];

  // RPC v2 via POST (JSON lida com arrays nativamente). Faz TODOS os filtros
  // simultâneos no banco e devolve o total na coluna `total`.
  const rpcRes = await sb('rpc/buscar_por_raio_v2', {
    method: 'POST',
    body: JSON.stringify({
      lat, lng,
      raio_metros: raioMetros,
      lim: porPagina,
      off: offset,
      tipos_filtro: tipos,
      estado_filtro: filtros.estado || '',
      modalidades_filtro: modalidades,
      pagamentos_filtro: pagamentos,
      valor_min: filtros.valorMin || 0,
      valor_max: filtros.valorMax || 9999999999,
    }),
  });

  if (!rpcRes.ok) {
    const err = await rpcRes.text().catch(() => '');
    if (err.includes('does not exist') || err.includes('function')) {
      return new Response(JSON.stringify({
        error: 'Função buscar_por_raio_v2 não existe no banco. Execute a migração SQL.',
        detalhes: err,
      }), { status: 503 });
    }
    return new Response(JSON.stringify({ error: 'Erro ao buscar por raio', detalhes: err }), { status: 500 });
  }

  const dados = await rpcRes.json();
  // total vem repetido em cada linha (window-less count via subselect); 0 linhas → 0
  const total = (dados && dados.length > 0 && dados[0].total != null) ? Number(dados[0].total) : 0;

  return new Response(JSON.stringify({
    resultados: dados || [],
    pagina,
    porPagina,
    total,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
