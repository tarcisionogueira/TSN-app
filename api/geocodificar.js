export const config = { runtime: 'edge' };
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
 * Geocodificação em cascata com 5 níveis de precisão:
 *
 * 0. CEP via ViaCEP → logradouro atual dos Correios → Nominatim com dados corrigidos
 *    Resolve ruas renomeadas e endereços desatualizados na matrícula.
 *
 * 1. Endereço completo (endereco + bairro + cidade + estado)  → 'endereco'
 *    Pin exato no imóvel, sem círculo.
 *
 * 1.5 Rua sem número (nome da rua + bairro + cidade + estado) → 'rua'
 *    Pin na rua + círculo de 100 m destacando o trecho.
 *
 * 2. Bairro (bairro + cidade + estado)                        → 'bairro'
 *    Pin no centro do bairro + círculo de 500 m no mapa.
 *
 * 3. Cidade (cidade + estado)                                 → 'cidade'
 *    Pin no centro da cidade + círculo de 2.000 m no mapa.
 *
 * Se nenhum nível resolver → retorna null (grava lat=0,lng=0 sentinela).
 */

// Consulta ViaCEP (Correios) para obter o logradouro oficial atualizado
async function viaCep(cep) {
  if (!cep) return null;
  const cepLimpo = cep.replace(/\D/g, '');
  if (cepLimpo.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.erro) return null; // CEP não encontrado
    return {
      logradouro: d.logradouro || null,
      bairro: d.bairro || null,
      cidade: d.localidade || null,
      uf: d.uf || null,
    };
  } catch {
    return null;
  }
}

// Remove número do endereço para tentar geocodificar só pelo nome da rua
// Ex: "Rua das Flores, 123 Apto 5" → "Rua das Flores"
// Ex: "Av. Brasil nº 45" → "Av. Brasil"
function extrairRua(endereco) {
  if (!endereco?.trim()) return null;
  const rua = endereco
    .replace(/,?\s*s\/n.*/i, '')                          // s/n e variações
    .replace(/,?\s*(n[°º]?\.?\s*)?\d[\d\-\/]*.*/i, '')   // número e tudo após
    .trim();
  return rua && rua.length > 4 && rua !== endereco.trim() ? rua : null;
}

// Extrai número do endereço para reusar com logradouro corrigido pelo ViaCEP
function extrairNumero(endereco) {
  if (!endereco?.trim()) return null;
  const m = endereco.match(/,?\s*(?:n[°º]?\.?\s*)?(\d[\d\-\/]*)/i);
  return m ? m[1] : null;
}

async function geocodificarCascata(im) {
  let { endereco, bairro, cidade, estado, cep } = im;

  // Nível 0 — CEP via ViaCEP (Correios): corrige logradouro desatualizado
  if (cep) {
    const via = await viaCep(cep);
    if (via?.logradouro) {
      // Reconstrói o endereço com o logradouro oficial dos Correios
      const numero = extrairNumero(endereco);
      const enderecoCorrigido = numero
        ? `${via.logradouro}, ${numero}`
        : via.logradouro;
      const bairroCorrigido = via.bairro || bairro;
      const cidadeCorrigida = via.cidade || cidade;
      const estadoCorrigido = via.uf || estado;

      const query = [enderecoCorrigido, bairroCorrigido, cidadeCorrigida, estadoCorrigido, 'Brasil'].filter(Boolean).join(', ');
      const coords = await nominatim(query);
      if (coords) return { ...coords, nivel: 'endereco' };
      await sleep(1320);

      // Tenta só o logradouro sem número
      const queryRua = [via.logradouro, bairroCorrigido, cidadeCorrigida, estadoCorrigido, 'Brasil'].filter(Boolean).join(', ');
      const coordsRua = await nominatim(queryRua);
      if (coordsRua) return { ...coordsRua, nivel: 'rua' };
      await sleep(1320);

      // Atualiza para o resto da cascata usar os dados corrigidos
      bairro = bairroCorrigido;
      cidade = cidadeCorrigida;
      estado = estadoCorrigido;
    }
  }

  // Nível 1 — endereço original completo (com número)
  if (endereco?.trim()) {
    const query = [endereco, bairro, cidade, estado, 'Brasil'].filter(Boolean).join(', ');
    const coords = await nominatim(query);
    if (coords) return { ...coords, nivel: 'endereco' };
    await sleep(1320);

    // Nível 1.5 — rua sem número
    const rua = extrairRua(endereco);
    if (rua) {
      const query2 = [rua, bairro, cidade, estado, 'Brasil'].filter(Boolean).join(', ');
      const coords2 = await nominatim(query2);
      if (coords2) return { ...coords2, nivel: 'rua' };
      await sleep(1320);
    }
  }

  // Nível 2 — bairro
  if (bairro?.trim()) {
    const query = [bairro, cidade, estado, 'Brasil'].filter(Boolean).join(', ');
    const coords = await nominatim(query);
    if (coords) return { ...coords, nivel: 'bairro' };
    await sleep(1320);
  }

  // Nível 3 — cidade
  if (cidade?.trim()) {
    const query = [cidade, estado, 'Brasil'].filter(Boolean).join(', ');
    const coords = await nominatim(query);
    if (coords) return { ...coords, nivel: 'cidade' };
    await sleep(1320);
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

async function processarLote(estadosFilter, lote = 50, limiteMs = null) {
  // Busca imóveis pendentes: latitude IS NULL (nunca geocodificados) OU latitude=0 (tentativa anterior falhou)
  // Usa duas queries separadas para evitar a sintaxe `or=()` do PostgREST que falha com parâmetros combinados
  // Sem filtro ativo — service key vê tudo; geocodifica independente do status
  const base = `imoveis_leilao?select=id,cidade,estado,endereco,bairro,cep${estadosFilter}&order=atualizado_em.desc&limit=${lote}`;
  const [r1, r2] = await Promise.all([
    sb(`${base}&latitude=is.null`),
    sb(`${base}&latitude=eq.0`),
  ]);
  if (!r1.ok || !r2.ok) return null;
  const [list1, list2] = await Promise.all([r1.json(), r2.json()]);
  // Combina e deduplica mantendo o limite
  const seen = new Set();
  const imoveis = [];
  for (const im of [...list1, ...list2]) {
    if (!seen.has(im.id)) { seen.add(im.id); imoveis.push(im); }
    if (imoveis.length >= lote) break;
  }
  if (!imoveis.length) return { processados: 0 };

  const res = { processados: imoveis.length, endereco: 0, bairro: 0, cidade: 0, rua: 0, falhas: 0, cache_hits: 0 };
  const inicioLote = Date.now();

  for (const im of imoveis) {
    // Guard de tempo: para antes de estourar o limite do Edge (30s no Vercel Hobby)
    if (limiteMs && (Date.now() - inicioLote) > limiteMs) break;
    const key = cacheKey(im);
    let coords, fromCache = false;

    if (!im.endereco?.trim() && coordCache[key]) {
      coords = coordCache[key];
      fromCache = true;
    } else {
      coords = await geocodificarCascata(im);
      if (coords && coords.nivel !== 'endereco') coordCache[key] = coords;
    }

    const salvo = await salvarCoords(im.id, coords);
    if (salvo && coords) { res[coords.nivel]++; if (fromCache) res.cache_hits++; }
    else res.falhas++;
    if (!fromCache) await sleep(1320);
  }

  return res;
}

async function isAdminUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  try {
    // 1. Valida o JWT via endpoint auth e obtém o user_id
    const authR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!authR.ok) return false;
    const userData = await authR.json();
    const userId = userData?.id;
    if (!userId) return false;

    // 2. Busca perfil do usuário pelo user_id usando service key (bypassa RLS corretamente)
    const perfisR = await fetch(`${SUPABASE_URL}/rest/v1/perfis?select=role&id=eq.${userId}&limit=1`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!perfisR.ok) return false;
    const rows = await perfisR.json();
    return rows?.[0]?.role === 'admin';
  } catch { return false; }
}

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Protege contra chamadas externas não autorizadas
  // POST manual do Admin: aceita JWT de usuário admin (sem precisar de CRON_SECRET)
  // GET/cron: exige CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (req.method === 'POST') {
    const sentCron = req.headers.get('x-cron-secret') || '';
    const cronOk = cronSecret && sentCron === cronSecret;
    if (!cronOk) {
      const adminOk = await isAdminUser(req);
      if (!adminOk) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 });
    }
  } else {
    // GET: apenas cron ou secret na URL
    if (cronSecret) {
      const url = new URL(req.url);
      const sent = req.headers.get('x-cron-secret') || url.searchParams.get('secret') || '';
      if (sent !== cronSecret) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 });
    }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase env vars not configured' }), { status: 500 });
  }

  // GET sem ?estados= → cron */10 0-9 * * * — deriva estado pelo horário UTC
  // Ordem por volume estimado (maiores praças primeiro) — ciclo de 270 min
  // A janela de 10h (00:00–09:59 UTC = 21:00–06:59 BRT) permite ~2 ciclos completos/noite
  // GET com ?estados= → trigger manual por URL
  // POST → admin manual (1 lote, retorna imediatamente para o painel monitorar)
  const ESTADOS_GEOCOD = [
    // Maiores volumes de imóveis (Caixa + leiloeiros) primeiro
    'SP','MG','PR','RS','RJ','SC','BA','GO','CE','PE',
    'MT','MS','ES','PA','MA','RN','PB','AL','PI','SE',
    'TO','RO','AM','DF','AC','AP','RR',
  ];
  const url = new URL(req.url, 'http://localhost');
  const qEstados = url.searchParams.get('estados');
  let estados = null;
  let modoManual = false;

  if (qEstados) {
    estados = qEstados.split(',').map(s => s.trim()).filter(Boolean);
  } else if (req.method === 'GET') {
    // Cron */10 * * * * — processa os próximos pendentes sem filtro de estado
    // Sem filtro: busca os 50 próximos de qualquer estado, maximiza throughput
    // Estados com mais pendentes naturalmente dominam (RJ 11k, SP 3.4k, etc.)
    estados = null;
  } else if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (Array.isArray(body.estados) && body.estados.length > 0) estados = body.estados;
    } catch {}
    modoManual = true;
  }

  const estadosFilter = estados?.length
    ? `&estado=in.(${estados.join(',')})`
    : '';

  // Modo cron (GET): loop até acabar todos os pendentes ou restar <30s de margem
  // Modo manual (POST): processa 1 lote de 50 e retorna (para o admin monitorar em tempo real)
  // Modo manual: lote pequeno (10) para caber no limite de 30s do Edge Hobby
  // O frontend chama em loop até processados=0
  if (modoManual) {
    // Lote 5: pior caso = 5 × (ViaCEP 5s + 4 × Nominatim 1.32s) = ~51s → limitado pelo guard interno de 22s
    const res = await processarLote(estadosFilter, 5, 22_000);
    if (!res) return new Response(JSON.stringify({ error: 'Supabase error ao buscar imóveis pendentes' }), { status: 500 });
    return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  // Modo cron: loop interno até ~25s (5s de margem antes do kill em 30s no Hobby)
  const LIMITE_MS = 25_000;
  const inicio = Date.now();
  const total = { processados: 0, endereco: 0, bairro: 0, cidade: 0, falhas: 0, cache_hits: 0, lotes: 0 };

  while (Date.now() - inicio < LIMITE_MS) {
    const res = await processarLote(estadosFilter, 50);
    if (!res || res.processados === 0) break; // sem mais pendentes
    total.processados += res.processados;
    total.endereco    += res.endereco;
    total.bairro      += res.bairro;
    total.cidade      += res.cidade;
    total.falhas      += res.falhas;
    total.cache_hits  += res.cache_hits;
    total.lotes++;
    if (res.processados < 50) break; // último lote
  }

  return new Response(JSON.stringify(total), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
