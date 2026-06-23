export const maxDuration = 300;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Marco: 5.000 imóveis ativos ou 500 novos/mês → migrar para Google Maps Geocoding API
const NOMINATIM_UA = 'BidProBrasil/1.0 (tarcisioaraujo@reimob.com.br)';

async function nominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

/**
 * Geocodificação em cascata com 3 níveis de precisão:
 *
 * 1. Endereço completo (endereco + bairro + cidade + estado)  → 'endereco'
 *    Pin exato no mapa, sem círculo.
 *
 * 2. Bairro (bairro + cidade + estado)                        → 'bairro'
 *    Pin no centro do bairro + círculo de 500 m no mapa.
 *
 * 3. Cidade (cidade + estado)                                 → 'cidade'
 *    Pin no centro da cidade + círculo de 2.000 m no mapa.
 *
 * Se nenhum nível resolver → retorna null (grava lat=0,lng=0 sentinela).
 */
async function geocodificarCascata(im) {
  const { endereco, bairro, cidade, estado } = im;

  // Nível 1 — endereço completo
  if (endereco && endereco.trim()) {
    const query = [endereco, bairro, cidade, estado, 'Brasil'].filter(Boolean).join(', ');
    const coords = await nominatim(query);
    if (coords) return { ...coords, nivel: 'endereco' };
    await sleep(1100);
  }

  // Nível 2 — bairro
  if (bairro && bairro.trim()) {
    const query = [bairro, cidade, estado, 'Brasil'].filter(Boolean).join(', ');
    const coords = await nominatim(query);
    if (coords) return { ...coords, nivel: 'bairro' };
    await sleep(1100);
  }

  // Nível 3 — cidade
  if (cidade && cidade.trim()) {
    const query = [cidade, estado, 'Brasil'].filter(Boolean).join(', ');
    const coords = await nominatim(query);
    if (coords) return { ...coords, nivel: 'cidade' };
    await sleep(1100);
  }

  return null;
}

async function salvarCoords(id, coords) {
  // Tenta salvar com geocod_nivel (requer migração add_geocod_nivel.sql)
  // Se a coluna não existir ainda, tenta sem ela
  const body = coords
    ? { latitude: coords.lat, longitude: coords.lng, geocod_nivel: coords.nivel }
    : { latitude: 0, longitude: 0, geocod_nivel: null };

  let res = await sb(`imoveis_leilao?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { Prefer: 'return=minimal' },
  });

  // Fallback: coluna geocod_nivel ainda não existe no banco
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    if (err.includes('geocod_nivel') || err.includes('column')) {
      const bodyFallback = coords
        ? { latitude: coords.lat, longitude: coords.lng }
        : { latitude: 0, longitude: 0 };
      res = await sb(`imoveis_leilao?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(bodyFallback),
        headers: { Prefer: 'return=minimal' },
      });
    }
  }
  return res.ok;
}

// Cache de coordenadas por bairro+cidade+estado para evitar chamadas redundantes ao Nominatim
// (~70-80% de redução em lotes com muitos imóveis do mesmo bairro)
const coordCache = {};

function cacheKey(im) {
  return `${(im.bairro || '').toLowerCase()}|${(im.cidade || '').toLowerCase()}|${(im.estado || '').toLowerCase()}`;
}

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase env vars not configured' }), { status: 500 });
  }

  let limite = 50;
  let estados = null; // null = todos
  try {
    const body = req.method === 'POST' ? await req.json() : {};
    if (body.limite) limite = Math.min(parseInt(body.limite) || 50, 200);
    if (Array.isArray(body.estados) && body.estados.length > 0) estados = body.estados;
  } catch {}

  // Filtra por estados se fornecido (para geocodificação paralela por região)
  let estadosFilter = '';
  if (estados && estados.length > 0) {
    const ufs = estados.map(e => `"${e}"`).join(',');
    estadosFilter = `&estado=in.(${ufs})`;
  }

  const r = await sb(
    `imoveis_leilao?select=id,cidade,estado,endereco,bairro&or=(latitude.is.null,latitude.eq.0)&ativo=eq.true${estadosFilter}&order=atualizado_em.desc&limit=${limite}`
  );
  if (!r.ok) {
    return new Response(JSON.stringify({ error: `Supabase error: ${r.status}` }), { status: 500 });
  }
  const imoveis = await r.json();

  if (!imoveis.length) {
    return new Response(JSON.stringify({ processados: 0, msg: 'Nenhum imóvel pendente de geocodificação' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const resultados = { processados: imoveis.length, endereco: 0, bairro: 0, cidade: 0, falhas: 0, cache_hits: 0 };

  for (const im of imoveis) {
    // Imóveis com endereço exato nunca usam cache (pin preciso é mais valioso)
    // Cache se aplica apenas a bairro/cidade (coordenada de centro compartilhada)
    const key = cacheKey(im);
    let coords;
    let fromCache = false;

    if (!im.endereco?.trim() && coordCache[key]) {
      coords = coordCache[key];
      fromCache = true;
    } else {
      coords = await geocodificarCascata(im);
      // Armazena no cache apenas resultados de bairro/cidade (não endereço exato)
      if (coords && coords.nivel !== 'endereco') coordCache[key] = coords;
    }

    const salvo = await salvarCoords(im.id, coords);
    if (salvo && coords) {
      resultados[coords.nivel]++;
      if (fromCache) resultados.cache_hits++;
    } else {
      resultados.falhas++;
    }
    if (!fromCache) await sleep(1100); // rate limit Nominatim apenas quando não é cache
  }

  return new Response(JSON.stringify(resultados), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
