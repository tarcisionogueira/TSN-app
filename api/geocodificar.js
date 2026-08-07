// Runtime NODE (batch longo até ~240s). Antes o handler devolvia `new Response()`,
// que no Node é IGNORADO → a função pendurava e estourava em 504 a cada execução
// do cron (geocodificação automática não rodava). Agora responde via res.*.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { geocodificarCascata } from './_geo.js';
import { isCronAuthorized } from './_auth.js';

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
  // Pendentes de coordenada OU aproximados (bairro/cidade) marcados para
  // reprocessamento (geocod_nivel='refazer') — a cascata melhorada (CEP) pode
  // agora alcançar nível rua/endereço onde antes caía no bairro.
  const r = await sb(
    `imoveis_leilao?select=id,titulo,cidade,estado,endereco,bairro,cep,condominio:nomecondominio&or=(latitude.is.null,and(latitude.eq.0,geocod_nivel.is.null),geocod_nivel.eq.refazer)&ativo=eq.true${estadosFilter}&order=atualizado_em.desc&limit=${lote}`
  );
  if (!r.ok) return null;
  const imoveis = await r.json();

  // BACKLOG "PRESO NO CENTROIDE" (07/08). A fila acima não enxerga o lote que JÁ foi
  // geocodificado e terminou em `cidade`: ele tem coordenada e não está em 'refazer', então
  // saía da fila para sempre exibindo o pino do centro do município. Era o caso do
  // `zuk_37094-231508` — endereço completo, CEP válido, e ainda assim nível 'cidade' depois
  // de reprocessar, porque as rotas gratuitas não conhecem o logradouro.
  // Medido hoje: 2.441 lotes ativos nessa situação COM número no endereço. Entram aqui em
  // fatias pequenas, e só eles ganham a rota paga (ver `temEnderecoCompleto` abaixo) —
  // sempre sob o teto mensal do Google, que já devolve no-op quando estoura.
  // O filtro de "tem número" é feito em JS porque o PostgREST não expõe regex; por isso
  // buscamos o dobro da fatia e descartamos o que não qualifica.
  const FATIA_CENTROIDE = 20;
  try {
    const rc = await sb(
      `imoveis_leilao?select=id,titulo,cidade,estado,endereco,bairro,cep,condominio:nomecondominio&geocod_nivel=eq.cidade&endereco=not.is.null&ativo=eq.true${estadosFilter}&order=atualizado_em.desc&limit=${FATIA_CENTROIDE * 2}`
    );
    if (rc.ok) {
      const presos = (await rc.json()).filter(x => /\d/.test(String(x.endereco || '')) && String(x.endereco).trim().length > 8);
      imoveis.push(...presos.slice(0, FATIA_CENTROIDE));
    }
  } catch { /* aditivo: o backlog normal segue mesmo se esta consulta falhar */ }

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
      // Cron em LOTE: por padrão só rotas GRATUITAS (Nominatim/IBGE/BrasilAPI) — o backlog
      // inteiro no Google custaria caro e a maioria dos lotes nem tem endereço para justificar.
      //
      // EXCEÇÃO (07/08), pedida pelo caso do lote `zuk_37094-231508`: quando o lote TEM
      // logradouro E número, as rotas grátis já provaram que não resolvem — o OSM
      // simplesmente não conhece boa parte das ruas brasileiras — e o resultado é o pino no
      // centroide da cidade. Foi o que aconteceu ali: "Rua José Miguel Ackel, 2252",
      // Guarulhos, CEP 07273000, endereço completo, e mesmo assim `geocod_nivel='cidade'`
      // depois de reprocessar. O efeito para o cliente não é cosmético: sem coordenada real
      // o mercadológico não acha comparáveis de Nível 1, então o relatório sai pior.
      // O Google é o único que conhece esses logradouros, e é exatamente o caso em que ele
      // se paga. NÃO é gasto aberto: `googleGeocode` já respeita `GOOGLE_GEOCODE_MAX_MES`
      // (default 10.000/mês = o tier grátis) e vira no-op ao bater o teto, caindo de volta
      // nas rotas gratuitas. Ou seja, o pior caso continua sendo custo ~US$ 0.
      const temEnderecoCompleto = /\d/.test(String(im.endereco || '')) && String(im.endereco || '').trim().length > 8;
      coords = await geocodificarCascata(im, { deadline, permitirPago: temEnderecoCompleto });
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

export default async function handler(req, resp) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return resp.status(405).send('Method not allowed');
  }

  // Auth de cron em tempo CONSTANTE (helper compartilhado isCronAuthorized) — falha
  // fechado se o CRON_SECRET não estiver configurado.
  if (!isCronAuthorized(req)) return resp.status(401).json({ error: 'Não autorizado' });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return resp.status(500).json({ error: 'Supabase env vars not configured' });
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
      const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
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
    if (!res) return resp.status(500).json({ error: 'Supabase error' });
    if (!res.processados) return resp.status(200).json({ processados: 0, msg: 'Nenhum imóvel pendente' });
    return resp.status(200).json(res);
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

  return resp.status(200).json(total);
}
