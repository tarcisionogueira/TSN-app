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

// Nominatim — 1 req/seg, sem chave, gratuito
// Marco de troca: atingir 5.000 imóveis ativos ou 500 novos/mês → migrar para Google Maps Geocoding API
async function geocodificarEndereco(cidade, estado, endereco) {
  const query = [endereco, cidade, estado, 'Brasil'].filter(Boolean).join(', ');
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BidProBrasil/1.0 (tarcisioaraujo@reimob.com.br)' },
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

// Aguarda 1.1 seg entre requisições para respeitar rate limit do Nominatim
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase env vars not configured' }), { status: 500 });
  }

  // Parâmetros: limite de imóveis por execução (padrão 50 para não exceder timeout)
  let limite = 50;
  try {
    const body = req.method === 'POST' ? await req.json() : {};
    if (body.limite) limite = Math.min(parseInt(body.limite) || 50, 200);
  } catch {}

  // Busca imóveis sem coordenadas, priorizando os mais recentes
  const r = await sb(`imoveis_leilao?select=id,cidade,estado,endereco&latitude=is.null&ativo=eq.true&order=atualizado_em.desc&limit=${limite}`);
  if (!r.ok) {
    return new Response(JSON.stringify({ error: `Supabase error: ${r.status}` }), { status: 500 });
  }
  const imoveis = await r.json();

  if (!imoveis.length) {
    return new Response(JSON.stringify({ processados: 0, msg: 'Nenhum imóvel pendente de geocodificação' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  let ok = 0;
  let falhas = 0;

  for (const im of imoveis) {
    const coords = await geocodificarEndereco(im.cidade, im.estado, im.endereco);
    if (coords) {
      await sb(`imoveis_leilao?id=eq.${im.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ latitude: coords.lat, longitude: coords.lng }),
        headers: { Prefer: 'return=minimal' },
      });
      ok++;
    } else {
      // Marca com coordenada sentinela (0,0) para não tentar de novo indefinidamente
      await sb(`imoveis_leilao?id=eq.${im.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ latitude: 0, longitude: 0 }),
        headers: { Prefer: 'return=minimal' },
      });
      falhas++;
    }
    await sleep(1100); // respeita rate limit Nominatim
  }

  return new Response(JSON.stringify({ processados: imoveis.length, geocodificados: ok, falhas }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
