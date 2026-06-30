export const maxDuration = 300;

import { geocodificarCascata } from './_geo.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    // Nenhuma chamada ao Supabase pode pendurar a função: timeout de 20s evita que
    // um PATCH/SELECT lento estoure o limite de 300s da serverless function.
    signal: opts.signal || AbortSignal.timeout(20000),
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


async function salvarCoords(id, coords) {
  // Tenta salvar com geocod_nivel (requer migração add_geocod_nivel.sql)
  // Se a coluna não existir ainda, tenta sem ela.
  // Ao gravar coordenada nova, ZERA pontos_proximos/proximidades_em: as
  // proximidades (Overpass) dependem da lat/lng, então precisam ser recalculadas
  // — senão um imóvel re-geocodificado fica com atrativos do local errado.
  const body = coords
    ? { latitude: coords.lat, longitude: coords.lng, geocod_nivel: coords.nivel,
        pontos_proximos: null, proximidades_em: null,
        ...(coords.cep ? { cep: coords.cep } : {}) }
    // Falha definitiva: marca 'falhou' (latitude=0) para sair da fila e não ser
    // re-tentado a cada ciclo (cada falha custa ~28s em 3 níveis do Nominatim).
    : { latitude: 0, longitude: 0, geocod_nivel: 'falhou' };

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

async function processarLote(estadosFilter, lote = 50, deadline = Infinity) {
  // Pendentes = sem coordenada (latitude NULL) ou sentinela 0 ainda NÃO marcada como
  // 'falhou'. Itens marcados 'falhou' saem da fila (não são re-tentados todo ciclo).
  const r = await sb(
    `imoveis_leilao?select=id,cidade,estado,endereco,bairro&or=(latitude.is.null,and(latitude.eq.0,geocod_nivel.is.null))&ativo=eq.true${estadosFilter}&order=atualizado_em.desc&limit=${lote}`
  );
  if (!r.ok) return null;
  const imoveis = await r.json();
  if (!imoveis.length) return { processados: 0 };

  // processados conta o que de fato foi tratado: o lote pode ser interrompido antes do fim
  // se o orçamento de tempo (deadline) acabar — por isso não usamos imoveis.length aqui.
  const res = { processados: 0, endereco: 0, bairro: 0, cidade: 0, falhas: 0, cache_hits: 0, interrompido: false };

  for (const im of imoveis) {
    // Cada item pode levar até ~27s (3 níveis de cascata × timeout de 8s do Nominatim).
    // Paramos ANTES de iniciar um novo item se o deadline já passou — evita estourar o maxDuration de 300s.
    if (Date.now() > deadline) { res.interrompido = true; break; }

    const key = cacheKey(im);
    let coords, fromCache = false;

    // Usa cache apenas para imóveis sem endereço completo (bairro/cidade) — endereço completo sempre geocodifica
    if (!im.endereco?.trim() && coordCache[key]) {
      coords = coordCache[key];
      fromCache = true;
    } else {
      coords = await geocodificarCascata(im, { deadline });
      // Salva no cache só nível bairro/cidade (sem endereço), para reutilizar em imóveis do mesmo bairro
      if (coords && coords.nivel !== 'endereco' && !im.endereco?.trim()) coordCache[key] = coords;
    }

    const salvo = await salvarCoords(im.id, coords);
    if (salvo && coords) { res[coords.nivel]++; if (fromCache) res.cache_hits++; }
    else res.falhas++;
    res.processados++;
    if (!fromCache) await sleep(1100);
  }

  return res;
}

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Protege contra chamadas externas não autorizadas — falha fechado se CRON_SECRET não configurado
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[geocodificar] CRON_SECRET não configurado — acesso bloqueado');
    return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 403 });
  }
  const _url = new URL(req.url, 'http://localhost');
  // Vercel cron envia: Authorization: Bearer <CRON_SECRET>
  // Chamadas manuais podem enviar: x-cron-secret header ou ?secret= query param
  const authHeader = (req.headers.get ? req.headers.get('authorization') : req.headers['authorization']) || '';
  const sent = (req.headers.get ? req.headers.get('x-cron-secret') : req.headers['x-cron-secret'])
    || _url.searchParams.get('secret')
    || authHeader.replace(/^Bearer\s+/i, '');
  if (sent !== cronSecret) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase env vars not configured' }), { status: 500 });
  }

  // GET sem ?estados= → cron */10 3,4,5,6,7 * * * — deriva estado pelo horário UTC
  // GET com ?estados= → trigger manual por URL
  // POST → admin manual (1 lote, retorna imediatamente para o painel monitorar)
  const ESTADOS_GEOCOD = [
    'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
    'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
    'RO','RR','RS','SC','SE','SP','TO',
  ];
  const reqUrl = new URL(req.url, 'http://localhost');
  const qEstados = reqUrl.searchParams.get('estados');
  let estados = null;
  let modoManual = false;

  if (qEstados) {
    estados = qEstados.split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{2}$/.test(s) && ESTADOS_GEOCOD.includes(s));
  } else if (req.method === 'GET') {
    // Cron */10 — processa a FILA GLOBAL de pendentes (qualquer estado), do mais
    // recente ao mais antigo. Antes processava 1 estado por execução (rotação por
    // minuto UTC), o que desperdiçava execuções em estados sem pendência. Processar
    // a fila global mantém toda execução útil e maximiza a vazão dentro do limite
    // de 1 req/s do Nominatim — zerando o backlog muito mais rápido, sem custo.
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
  if (modoManual) {
    const res = await processarLote(estadosFilter, 50, Date.now() + 240_000);
    if (!res) return new Response(JSON.stringify({ error: 'Supabase error' }), { status: 500 });
    if (!res.processados) return new Response(JSON.stringify({ processados: 0, msg: 'Nenhum imóvel pendente' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  // Modo cron: loop interno — processa tudo que couber em ~270s (margem de 30s antes do timeout)
  // Orçamento conservador: 240s deixa ~60s de folga até o limite de 300s da função,
  // suficiente para o pior caso (uma chamada Nominatim de 8s iniciada perto do deadline).
  const LIMITE_MS = 240_000;
  const inicio = Date.now();
  const deadline = inicio + LIMITE_MS;
  const total = { processados: 0, endereco: 0, bairro: 0, cidade: 0, falhas: 0, cache_hits: 0, lotes: 0 };

  while (Date.now() < deadline) {
    const res = await processarLote(estadosFilter, 50, deadline);
    if (!res || res.processados === 0) break; // sem mais pendentes
    total.processados += res.processados;
    total.endereco    += res.endereco;
    total.bairro      += res.bairro;
    total.cidade      += res.cidade;
    total.falhas      += res.falhas;
    total.cache_hits  += res.cache_hits;
    total.lotes++;
    if (res.interrompido) break;     // deadline atingido no meio do lote — encerra com folga antes dos 300s
    if (res.processados < 50) break; // último lote (menos de 50 pendentes)
  }

  return new Response(JSON.stringify(total), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
