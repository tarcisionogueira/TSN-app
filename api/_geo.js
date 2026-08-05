/**
 * Helpers de geolocalização — qualidade de endereço cruzando IBGE + Correios.
 *
 * Estratégia (mantém o Nominatim como fonte da coordenada):
 *  - IBGE   → centróide oficial do município (validação de UF/cidade e fallback
 *             no nível 'cidade', sem depender de rede). Mata os erros cross-UF.
 *  - Correios/ViaCEP → normaliza o logradouro sujo do CEF e preenche o CEP,
 *             melhorando o "acerto" do Nominatim no nível de rua.
 *  - Nominatim (busca ESTRUTURADA) → a lat/lng de fato.
 *
 * Todo resultado do Nominatim é VALIDADO contra o IBGE (dentro da UF e a uma
 * distância plausível do centróide do município); fora disso, é descartado.
 */
import MUNICIPIOS from './_municipios.js';
import { registrarUso, unidadesUsadasHoje, unidadesUsadasMes } from './_uso.js';

// UF → nome por extenso (para o parâmetro `state=` do Nominatim) + bounding box
// generosa (validação de "está no estado certo?"). [latMin, latMax, lngMin, lngMax]
export const UFS = {
  AC: { nome: 'Acre', bbox: [-11.2, -7.0, -74.0, -66.4] },
  AL: { nome: 'Alagoas', bbox: [-10.6, -8.7, -38.3, -35.0] },
  AP: { nome: 'Amapá', bbox: [-1.3, 4.5, -55.0, -49.8] },
  AM: { nome: 'Amazonas', bbox: [-9.9, 2.3, -73.9, -56.0] },
  BA: { nome: 'Bahia', bbox: [-18.5, -8.4, -46.7, -37.2] },
  CE: { nome: 'Ceará', bbox: [-7.9, -2.7, -41.5, -37.1] },
  DF: { nome: 'Distrito Federal', bbox: [-16.1, -15.4, -48.3, -47.3] },
  ES: { nome: 'Espírito Santo', bbox: [-21.4, -17.8, -41.9, -39.6] },
  GO: { nome: 'Goiás', bbox: [-19.6, -12.3, -53.3, -45.9] },
  MA: { nome: 'Maranhão', bbox: [-10.3, -1.0, -48.8, -41.7] },
  MT: { nome: 'Mato Grosso', bbox: [-18.1, -7.3, -61.7, -50.2] },
  MS: { nome: 'Mato Grosso do Sul', bbox: [-24.1, -17.1, -58.2, -50.8] },
  MG: { nome: 'Minas Gerais', bbox: [-22.95, -14.2, -51.1, -39.8] },
  PA: { nome: 'Pará', bbox: [-9.9, 2.6, -58.9, -46.0] },
  PB: { nome: 'Paraíba', bbox: [-8.4, -6.0, -38.8, -34.7] },
  PR: { nome: 'Paraná', bbox: [-26.8, -22.4, -54.7, -48.0] },
  PE: { nome: 'Pernambuco', bbox: [-9.5, -7.2, -41.4, -34.8] },
  PI: { nome: 'Piauí', bbox: [-10.95, -2.7, -45.9, -40.3] },
  RJ: { nome: 'Rio de Janeiro', bbox: [-23.45, -20.7, -44.9, -40.9] },
  RN: { nome: 'Rio Grande do Norte', bbox: [-6.6, -4.8, -38.6, -34.9] },
  RS: { nome: 'Rio Grande do Sul', bbox: [-33.8, -27.0, -57.7, -49.6] },
  RO: { nome: 'Rondônia', bbox: [-13.7, -7.9, -66.9, -59.7] },
  RR: { nome: 'Roraima', bbox: [-1.6, 5.3, -64.9, -58.8] },
  SC: { nome: 'Santa Catarina', bbox: [-29.5, -25.9, -53.9, -48.3] },
  SP: { nome: 'São Paulo', bbox: [-25.4, -19.7, -53.2, -44.1] },
  SE: { nome: 'Sergipe', bbox: [-11.6, -9.4, -38.3, -36.3] },
  TO: { nome: 'Tocantins', bbox: [-13.5, -5.1, -50.8, -45.7] },
};

export function normalizar(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function haversineKm(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (c - a) * r, dLng = (d - b) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// Centróide oficial IBGE do município (ou null se desconhecido).
export function centroideIBGE(cidade, estado) {
  const uf = String(estado || '').trim().toUpperCase();
  const c = MUNICIPIOS[`${uf}|${normalizar(cidade)}`];
  return c ? { lat: c[0], lng: c[1] } : null;
}

// Resultado é plausível? Precisa estar dentro da UF e a no máx. `maxKm` do
// centróide do município (quando conhecido). Pega cross-UF e erros grosseiros.
export function coordValida(lat, lng, estado, cidade, maxKm = 80) {
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return false;
  const uf = UFS[String(estado || '').trim().toUpperCase()];
  if (uf) {
    const [laMin, laMax, lnMin, lnMax] = uf.bbox;
    if (lat < laMin || lat > laMax || lng < lnMin || lng > lnMax) return false;
  }
  const cen = centroideIBGE(cidade, estado);
  if (cen && haversineKm(lat, lng, cen.lat, cen.lng) > maxKm) return false;
  return true;
}

// Nível REAL do resultado: quando o Nominatim não acha o endereço "sujo" (Lt/Qd/Apto)
// de uma cidade pequena, ele devolve o CENTRO do município. Esse ponto passa no
// coordValida (está na UF certa) e era rotulado 'endereco' só porque o INPUT tinha
// número → pino "exato" no centro da cidade (a queixa "pino longe do imóvel"). Se o
// resultado caiu ~em cima do centróide IBGE, rebaixa para 'cidade' (aproximado).
export function nivelReal(nivelBase, lat, lng, cidade, estado) {
  const cen = centroideIBGE(cidade, estado);
  if (cen && haversineKm(lat, lng, cen.lat, cen.lng) < 0.25) return 'cidade';
  return nivelBase;
}

// Nível do que o Nominatim de fato ENCONTROU (class/type/addresstype do resultado) — o
// complemento do nivelReal. O nivelReal só pega o fallback que cai EM CIMA do centróide
// IBGE; mas quando a rua não existe no OSM, o Nominatim casa só a CIDADE e devolve o NÓ
// dele para o município — que fica longe do centróide IBGE (Guarulhos: 1,6 km) e passava
// batido. O rótulo era decidido pelo INPUT ("pedi rua+número → 'endereco'"), não pelo que
// foi encontrado → 3.458 lotes com ponto genérico rotulados 'rua'/'endereco' (achado
// 05/08, gatilho: lote do Rafael). Aqui classificamos o RESULTADO; null = tipo neutro
// (POI/postcode), o chamador mantém o nível pretendido.
export function nivelNominatim(r) {
  const classe = String(r?.class || '').toLowerCase();
  const tipo = String(r?.type || '').toLowerCase();
  const addr = String(r?.addresstype || '').toLowerCase();
  if (classe === 'building' || tipo === 'house' || tipo === 'building' || addr === 'building' || addr === 'house') return 'endereco';
  if (classe === 'highway' || addr === 'road') return 'rua'; // antes do check de bairro: highway/residential é RUA residencial
  if (['suburb', 'neighbourhood', 'quarter', 'borough', 'city_block'].includes(tipo)
    || ['suburb', 'neighbourhood', 'quarter', 'borough'].includes(addr)) return 'bairro';
  if (classe === 'boundary'
    || ['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state', 'region', 'administrative'].includes(tipo)
    || ['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state'].includes(addr)) return 'cidade';
  return null;
}

// Teto de nível: o rótulo final nunca é mais preciso do que o resultado suporta.
export const capNivel = (alvo, match) =>
  (match && (NIVEL_RANK[match] ?? 9) < (NIVEL_RANK[alvo] ?? 0) ? match : alvo);

// Extrai "logradouro + número" do endereço bagunçado do CEF.
// "Rua Raposos, N. 548, Cs 01 Lt 22 Qd 58"  -> { via:'Rua Raposos', numero:'548' }
// "Rua 20, N. S/n"                           -> { via:'Rua 20',     numero:'' }
export function parseLogradouro(endereco) {
  const raw = String(endereco || '').trim();
  if (!raw) return { via: '', numero: '' };
  const segs = raw.split(',').map(s => s.trim()).filter(Boolean);
  const via = (segs[0] || '').replace(/\s+/g, ' ').trim();
  let numero = '';
  for (const s of segs.slice(1)) {
    const m = s.match(/^n\.?\s*º?\s*(.+)$/i); // segmento "N. 548" / "Nº 548"
    if (m) {
      const v = m[1].trim();
      if (!/^s\/?n$/i.test(v) && /\d/.test(v)) numero = (v.match(/\d+/) || [''])[0];
      break;
    }
  }
  return { via, numero };
}

// Correios/ViaCEP: dado UF + cidade + nome do logradouro, devolve a versão
// canônica (logradouro/bairro/CEP). NÃO devolve coordenada — serve para limpar a
// consulta e enriquecer o CEP. Tolerante a falha (retorna null).
export async function viacepCanonico(uf, cidade, via, timeoutMs = 6000) {
  const nomeVia = String(via || '').replace(/^(rua|av\.?|avenida|travessa|tv\.?|alameda|al\.?|rodovia|rod\.?|estrada|estr\.?|praça|praca|largo|viela|quadra|qd\.?)\s+/i, '').trim();
  if (!uf || !cidade || nomeVia.length < 3) return null;
  const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(nomeVia)}/json/`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) return null;
    const r = arr[0];
    return { cep: r.cep || null, logradouro: r.logradouro || null, bairro: r.bairro || null };
  } catch {
    return null;
  }
}

const NOMINATIM_UA = 'BidProBrasil/1.0 (tarcisioaraujo@reimob.com.br)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch com retry/backoff para os provedores de geocoding: um 429/5xx ou queda de
// rede transitória deixava o imóvel cair de nível (perda de precisão silenciosa).
// Re-tenta em 429/5xx e erro de rede, honrando Retry-After. Devolve Response ou null.
const RETRY_GEO = new Set([429, 500, 502, 503, 504]);
async function fetchGeo(url, opts, retries = 2) {
  for (let t = 0; t <= retries; t++) {
    try {
      const res = await fetch(url, opts);
      if (!RETRY_GEO.has(res.status) || t === retries) return res;
      const ra = Number(res.headers.get('retry-after'));
      await sleep(ra > 0 ? ra * 1000 : 600 * 2 ** t);
    } catch {
      if (t === retries) return null;
      await sleep(600 * 2 ** t);
    }
  }
  return null;
}

// Ranking de precisão (maior = melhor). Usado para "só sobe, nunca desce".
export const NIVEL_RANK = { endereco: 4, rua: 3, bairro: 2, cidade: 1, falhou: 0 };
export const rankNivel = (n) => NIVEL_RANK[n] ?? 0;

// Busca ESTRUTURADA no Nominatim (trava cidade/estado → sem erro de UF homônima).
export async function nominatimEstruturado(params) {
  const qs = new URLSearchParams({ format: 'json', addressdetails: '1', limit: '1', countrycodes: 'br' });
  if (params.street) qs.set('street', params.street);
  if (params.city) qs.set('city', params.city);
  if (params.state) qs.set('state', params.state);
  if (params.postalcode) qs.set('postalcode', params.postalcode);
  try {
    const res = await fetchGeo(`https://nominatim.openstreetmap.org/search?${qs}`, {
      headers: { 'User-Agent': NOMINATIM_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;
    // nivelMatch = o que o resultado É (rua? bairro? o nó da cidade?) — o chamador usa
    // como TETO do rótulo. A busca estruturada também cai para a cidade quando a rua
    // pedida não existe no OSM.
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), nivelMatch: nivelNominatim(data[0]) };
  } catch {
    return null;
  }
}

// Busca por TEXTO LIVRE (q=). Endereços "sujos" da Caixa (com Lt/Qd/Apto no meio)
// quebram a busca estruturada, mas o parser de texto livre do Nominatim costuma
// acertar. Fallback grátis, sem depender de chave.
export async function nominatimTextoLivre(q) {
  if (!q || !q.trim()) return null;
  const qs = new URLSearchParams({ format: 'json', addressdetails: '1', limit: '1', countrycodes: 'br', q });
  try {
    const res = await fetchGeo(`https://nominatim.openstreetmap.org/search?${qs}`, {
      headers: { 'User-Agent': NOMINATIM_UA }, signal: AbortSignal.timeout(8000),
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;
    // O parser de texto livre é o MAIS propenso a "casar só a cidade": quando a rua não
    // está no OSM ele devolve o nó do município como se fosse resposta. nivelMatch conta
    // ao chamador o que veio de verdade — era a lacuna que gravava ponto genérico como 'rua'.
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), nivelMatch: nivelNominatim(data[0]) };
  } catch { return null; }
}

// GOOGLE GEOCODING — padrão-ouro de precisão no Brasil. Ativado (GOOGLE_MAPS_API_KEY
// configurada no Vercel). Só roda se houver a chave; crédito grátis mensal cobre. Devolve o
// nível conforme a precisão (ROOFTOP/RANGE = endereço exato). É a 1ª opção da
// cascata; sem a chave, cai no Nominatim normalmente.
export async function googleGeocode(enderecoCompleto) {
  // Chave de SERVIDOR: nunca aceitar de var VITE_* (essas vão para o bundle público
  // do front por definição do Vite → chave paga exposta a qualquer visitante).
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!key || !enderecoCompleto || !enderecoCompleto.trim()) return null;
  // TRAVA DE CUSTO — teto MENSAL alinhado ao tier GRÁTIS do Google (~10k/MÊS). Batido o
  // teto do mês, a função vira no-op (return null) e a cascata segue nas rotas GRATUITAS
  // (Nominatim/IBGE/BrasilAPI) — garante custo ~US$0. Combinada com o cron rodando
  // `permitirPago:false` (Google só on-demand na página do imóvel), o consumo mensal fica
  // bem abaixo do teto. GOOGLE_GEOCODE_MAX_DIA (default 0/desligado) é um sub-teto DIÁRIO
  // opcional anti-spike/smoothing; 0 em qualquer um = sem aquele teto.
  const LIMITE_MES = Number(process.env.GOOGLE_GEOCODE_MAX_MES ?? 10000);
  if (LIMITE_MES > 0 && (await unidadesUsadasMes('google_geocode')) >= LIMITE_MES) return null;
  const LIMITE_DIA = Number(process.env.GOOGLE_GEOCODE_MAX_DIA ?? 0);
  if (LIMITE_DIA > 0 && (await unidadesUsadasHoje('google_geocode')) >= LIMITE_DIA) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(enderecoCompleto)}&region=br&language=pt-BR&key=${key}`;
  try {
    const res = await fetchGeo(url, { signal: AbortSignal.timeout(8000) });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.length) return null;
    const r = data.results[0];
    const loc = r.geometry?.location;
    if (!loc) return null;
    const lt = r.geometry.location_type; // ROOFTOP > RANGE_INTERPOLATED > GEOMETRIC_CENTER > APPROXIMATE
    const nivel = (lt === 'ROOFTOP' || lt === 'RANGE_INTERPOLATED') ? 'endereco'
      : lt === 'GEOMETRIC_CENTER' ? 'rua' : 'bairro';
    registrarUso('google_geocode', 'geocode', { unidades: 1 }); // grátis até 10k/mês; custo além disso no painel
    return { lat: loc.lat, lng: loc.lng, nivel };
  } catch { return null; }
}

// BRASILAPI CEP → coordenada (grátis, sem chave). A API v2 da BrasilAPI enriquece o
// CEP com coordenadas quando disponíveis. É mais precisa que o nível 'bairro', então
// entra na cascata como uma rota de nível 'rua' sempre que houver um CEP.
// `location.coordinates.{latitude,longitude}` vêm como STRING e podem faltar/vazias.
export async function brasilapiCep(cep) {
  const cepLimpo = String(cep || '').replace(/\D/g, '');
  if (cepLimpo.length !== 8) return null;
  try {
    const res = await fetchGeo(`https://brasilapi.com.br/api/cep/v2/${cepLimpo}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    const co = data?.location?.coordinates;
    const lat = parseFloat(co?.latitude);
    const lng = parseFloat(co?.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng };
  } catch { return null; }
}

// GEOCODER PAGO — tier pronto para ativar, mas inerte hoje. Só roda se GEOCODER_KEY
// estiver setada no ambiente; sem a chave, é no-op (return null) e nada muda. Provedor
// padrão LocationIQ (compatível com Nominatim). Mapeia o nível pela natureza do
// resultado (house/building → endereço, road → rua, resto → bairro).
export async function geocoderPago(enderecoCompleto) {
  const key = (process.env.GEOCODER_KEY || '').trim();
  if (!key || !enderecoCompleto || !enderecoCompleto.trim()) return null;
  const url = `https://us1.locationiq.com/v1/search?key=${encodeURIComponent(key)}&q=${encodeURIComponent(enderecoCompleto)}&format=json&countrycodes=br&limit=1&addressdetails=1`;
  try {
    const res = await fetchGeo(url, { signal: AbortSignal.timeout(8000) });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    const r = data[0];
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    const tipo = String(r.type || '').toLowerCase();
    const classe = String(r.class || '').toLowerCase();
    const nivel = (tipo === 'house' || tipo === 'building' || classe === 'building') ? 'endereco'
      : (classe === 'highway' || tipo === 'road' || tipo === 'residential') ? 'rua'
      : 'bairro';
    registrarUso('locationiq', 'geocode', { unidades: 1 }); // geocoder pago (por chamada)
    return { lat, lng, nivel };
  } catch { return null; }
}

/**
 * Cascata de geocodificação cruzando IBGE (validação/UF + fallback cidade) e
 * Correios/ViaCEP (limpeza do logradouro + CEP), com o Nominatim como fonte da
 * coordenada (busca estruturada + validação). Retorna { lat, lng, nivel, cep? }
 * ou null. `sleepMs`=0 desliga as pausas (uso on-demand de 1 imóvel).
 */
// ── SANEAMENTO do sinal de localização (correção 30/07 — geo on-demand "não funcionava") ──
// O scraper às vezes deixa `endereco` com LIXO ("praça Valor inicial R$, 166") e o endereço/
// bairro REAL fica só no TÍTULO ("Apartamento 74 m² - Carapicuíba-SP - Rua Eduardo Augusto
// Mesquita, 1.372 - ..."). A sessão 18 corrigiu isso SÓ no relatório (gerar-analise); a cascata
// seguia geocodificando o lixo → imóvel preso no nível bairro/cidade mesmo com o on-demand
// rodando. Mesmas regras aqui, na RAIZ (vale p/ on-demand E crons). Tolerante: sem `titulo`
// no objeto, apenas filtra o lixo.
const RE_END_LIXO = /valor\s*inicial|lance\s*m[íi]nimo|avalia[çc]|r\$|^\s*\d+\s*$/i;
export function sanearLocalizacao(im) {
  const out = { ...im };
  const t = String(out.titulo || '');
  const endStr = String(out.endereco || '').trim();
  const ruaOk = endStr.length >= 6 && /[a-zà-ú]{3}/i.test(endStr) && !RE_END_LIXO.test(endStr);
  if (!ruaOk) out.endereco = '';
  // Endereço embutido no título: "Rua X, 1.372" / "Avenida Y, nº 45" (nº aceita ponto de milhar).
  if (!out.endereco && t) {
    const m = t.match(/((?:rua|avenida|av\.?|travessa|tv\.?|alameda|al\.?|estrada|estr\.?|rodovia|rod\.?|pra[çc]a|largo|viela)\s+[^,;–—-]{3,60}?),?\s*(?:n[º°.]?\s*)?([\d.]{1,7})\b/i);
    if (m) {
      const num = m[2].replace(/\./g, '');
      if (/^\d{1,6}$/.test(num)) out.endereco = `${m[1].replace(/\s+/g, ' ').trim()}, ${num}`;
    }
  }
  // Bairro do título: "Tipo 00 m² - BAIRRO - Cidade - UF" (mesma regra do gerar-analise).
  if (!String(out.bairro || '').trim() && t) {
    const segs = t.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
    const ehTipoArea = (s) => /m²|m2|apartamento|casa|terreno|\blote\b|sala|loja|gal[pnã]|comercial|ch[aá]cara|s[íi]tio|fazenda|vaga|garagem|im[óo]vel|\d/i.test(s);
    const cand = segs.find((s) => s && !ehTipoArea(s) && normalizar(s) !== normalizar(out.cidade || '') && !/^[a-z]{2}$/i.test(s));
    if (cand) out.bairro = cand;
  }
  return out;
}

// Localidade (cidade) de um CEP no ViaCEP — para DESCARTAR CEP contaminado: o doc-scan
// às vezes captura o CEP do ESCRITÓRIO do leiloeiro (ex.: imóvel de Osasco com CEP da
// capital) e a cascata inteira gravita para a cidade errada.
export async function cepConfereCidade(cep, cidade, timeoutMs = 6000) {
  const cepLimpo = String(cep || '').replace(/\D/g, '');
  if (cepLimpo.length !== 8 || !cidade) return true; // sem dado p/ conferir → não bloqueia
  try {
    const res = await fetchGeo(`https://viacep.com.br/ws/${cepLimpo}/json/`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res || !res.ok) return true;
    const j = await res.json();
    if (j?.erro || !j?.localidade) return true;
    return normalizar(j.localidade) === normalizar(cidade);
  } catch { return true; }
}

export async function geocodificarCascata(imBruto, { deadline = Infinity, sleepMs = 1100, permitirPago = true } = {}) {
  const im = sanearLocalizacao(imBruto);
  let { endereco, bairro, cidade, estado, cep, condominio } = im;
  // CEP que não pertence à cidade do imóvel = contaminação → ignora (a rua/bairro decidem).
  if (cep && !(await cepConfereCidade(cep, cidade))) cep = null;
  const ufNome = UFS[String(estado || '').trim().toUpperCase()]?.nome || estado;
  const cond = String(condominio || '').trim();
  // Tolerância ao centróide do município POR PRECISÃO. Antes era 80 km fixo — frouxo
  // demais: um BAIRRO homônimo em OUTRO município (ex.: "Vila N. Sra. de Fátima" de
  // São Vicente caindo a 55 km, perto de Barueri) passava e o imóvel aparecia na
  // cidade errada. Providers precisos (Google) toleram mais (endereço real distante
  // em município grande); as rotas gratuitas propensas a homônimo são apertadas.
  const aceita = (c, maxKm = 40) => (c && coordValida(c.lat, c.lng, estado, cidade, maxKm) ? c : null);
  const pausa = () => (sleepMs > 0 ? sleep(sleepMs) : Promise.resolve());

  // Nível 0 — GOOGLE (mais preciso no Brasil). Endereço completo em texto; o Google
  // lida bem com "Lt/Qd/Apto" e nomes de condomínio. Validado contra o IBGE.
  // TRIAGEM DO SINAL: o anúncio às vezes dá só o CONDOMÍNIO/empreendimento (prédio nomeado),
  // às vezes a rua sem número, às vezes o endereço completo. O condomínio nomeado é uma âncora
  // tão precisa quanto (ou mais que) "rua sem número" → entra na FRENTE da string do Google e
  // ganha um passo próprio no Nominatim (POI). Assim, com o que houver, atribuímos a MELHOR posição.
  const { via, numero } = parseLogradouro(endereco);
  const enderecoGoogle = [
    cond || null,
    [via, numero].filter(Boolean).join(', ') || endereco,
    bairro, cidade, estado ? `${estado}` : '', cep ? `CEP ${cep}` : '', 'Brasil',
  ].filter(Boolean).join(', ');
  // `permitirPago` (default true) libera as rotas PAGAS (Google/LocationIQ). O cron de
  // geocodificação em LOTE passa `false` → usa só as rotas gratuitas (Nominatim/IBGE/
  // BrasilAPI), reservando o Google para o on-demand (página do imóvel), onde a
  // precisão importa e o volume é limitado. É a metade "sob demanda" da contenção de custo.
  if (permitirPago && Date.now() < deadline) {
    const g = aceita(await googleGeocode(enderecoGoogle), 60); // Google é padrão-ouro: tolera endereço real distante
    if (g) return { ...g, cep: cep || null };
  }

  // Nível 0.5 — GEOCODER PAGO (LocationIQ), pronto para ativar via GEOCODER_KEY.
  // Sem a chave é no-op. Roda depois do Google e antes das rotas públicas do
  // Nominatim, pois quando ativo é mais confiável que os provedores gratuitos.
  if (permitirPago && Date.now() < deadline) {
    const p = aceita(await geocoderPago(enderecoGoogle), 55);
    if (p) return { ...p, cep: cep || null };
  }

  // Nível 0.6 — CONDOMÍNIO como POI (grátis): o Nominatim texto-livre acha prédios/condomínios
  // nomeados do OSM. Só entra quando o anúncio deu o nome do empreendimento; precisão ~rua
  // (edifício). Vem antes do logradouro porque um prédio nomeado é âncora melhor que rua s/nº.
  if (cond.length >= 3 && Date.now() < deadline) {
    const qc = [cond, bairro, cidade, ufNome, 'Brasil'].filter(Boolean).join(', ');
    const cc = aceita(await nominatimTextoLivre(qc));
    if (cc) return { lat: cc.lat, lng: cc.lng, nivel: nivelReal(capNivel('rua', cc.nivelMatch), cc.lat, cc.lng, cidade, estado), cep: cep || null };
    await pausa();
  }

  // Nível 1 — logradouro + número (estruturado + validação IBGE).
  let cepEnc = null;
  if (via && Date.now() < deadline) {
    const street = [via, numero].filter(Boolean).join(' ');
    const c = aceita(await nominatimEstruturado({ street, city: cidade, state: ufNome }));
    if (c) return { lat: c.lat, lng: c.lng, nivel: nivelReal(capNivel(numero ? 'endereco' : 'rua', c.nivelMatch), c.lat, c.lng, cidade, estado) };
    await pausa();
    // Recuperação via Correios: canoniza o logradouro e tenta de novo.
    if (Date.now() < deadline) {
      const via2 = await viacepCanonico(estado, cidade, via);
      if (via2?.logradouro) {
        cepEnc = via2.cep || null;
        const street2 = [via2.logradouro, numero].filter(Boolean).join(' ');
        const c2 = aceita(await nominatimEstruturado({ street: street2, city: cidade, state: ufNome }));
        if (c2) return { lat: c2.lat, lng: c2.lng, nivel: nivelReal(capNivel(numero ? 'endereco' : 'rua', c2.nivelMatch), c2.lat, c2.lng, cidade, estado), cep: cepEnc };
        await pausa();
      }
    }
    // Nível 1.2 — TEXTO LIVRE no Nominatim (grátis). A busca estruturada quebra com
    // endereço sujo ("Lt/Qd/Apto"); o parser de texto livre costuma acertar a rua.
    if (Date.now() < deadline) {
      const ql = [[via, numero].filter(Boolean).join(' '), bairro, cidade, ufNome, 'Brasil'].filter(Boolean).join(', ');
      const cl = aceita(await nominatimTextoLivre(ql));
      if (cl) return { lat: cl.lat, lng: cl.lng, nivel: nivelReal(capNivel(numero ? 'endereco' : 'rua', cl.nivelMatch), cl.lat, cl.lng, cidade, estado), cep: cepEnc };
      await pausa();
    }
  }

  // Nível 1.5 — CEP (do imóvel ou recuperado no ViaCEP acima). O CEP brasileiro
  // é granular (rua/quadra), então geocodificar por postalcode alcança nível
  // 'rua' mesmo quando o Nominatim não encontra o NOME da rua (comum na Caixa).
  const cepLimpo = String(cep || cepEnc || '').replace(/\D/g, '');
  if (cepLimpo.length === 8 && Date.now() < deadline) {
    // BrasilAPI: coordenada direta do CEP (grátis, sem chave). Mais precisa que o
    // bairro; tratada como nível 'rua'. Roda antes do postalcode do Nominatim.
    // nivelReal também aqui: CEP "da cidade inteira" (municípios de CEP único) devolve o
    // ponto genérico do município — rotular 'rua' repetia o bug do pino no centro.
    const cb = aceita(await brasilapiCep(cepLimpo));
    if (cb) return { lat: cb.lat, lng: cb.lng, nivel: nivelReal('rua', cb.lat, cb.lng, cidade, estado), cep: cepLimpo };
    const c = aceita(await nominatimEstruturado({ postalcode: cepLimpo, city: cidade, state: ufNome }));
    if (c) return { lat: c.lat, lng: c.lng, nivel: nivelReal(capNivel('rua', c.nivelMatch), c.lat, c.lng, cidade, estado), cep: cepLimpo };
    await pausa();
  }

  // Nível 1.6 — sem CEP conhecido, mas com bairro: tenta o ViaCEP pelo BAIRRO
  // para descobrir um CEP da região (melhor que o centróide do bairro inteiro).
  if (!cepLimpo && bairro && bairro.trim() && cidade && Date.now() < deadline) {
    const viaB = await viacepCanonico(estado, cidade, bairro);
    const cepB = String(viaB?.cep || '').replace(/\D/g, '');
    if (cepB.length === 8 && Date.now() < deadline) {
      const c = aceita(await nominatimEstruturado({ postalcode: cepB, city: cidade, state: ufNome }));
      if (c) return { lat: c.lat, lng: c.lng, nivel: capNivel('bairro', c.nivelMatch), cep: cepB };
      await pausa();
    }
  }

  // Nível 2 — bairro. APERTADO (25 km): é o nível mais propenso a homônimo em outro
  // município (nome de bairro repete pelo Brasil). Fora de 25 km do centróide, é quase
  // certo que casou no município errado → descarta e cai no centróide da cidade.
  if (bairro && bairro.trim() && Date.now() < deadline) {
    const c = aceita(await nominatimEstruturado({ street: bairro, city: cidade, state: ufNome }), 25);
    if (c) return { lat: c.lat, lng: c.lng, nivel: capNivel('bairro', c.nivelMatch), cep: cepEnc };
    await pausa();
  }

  // Nível 3 — cidade: centróide IBGE (instantâneo, sempre na UF certa).
  const cen = centroideIBGE(cidade, estado);
  if (cen) return { lat: cen.lat, lng: cen.lng, nivel: 'cidade', cep: cepEnc };

  // Último recurso: cidade via Nominatim (cidades fora do IBGE local).
  if (cidade && cidade.trim() && Date.now() < deadline) {
    const c = aceita(await nominatimEstruturado({ city: cidade, state: ufNome }));
    if (c) return { lat: c.lat, lng: c.lng, nivel: 'cidade', cep: cepEnc };
    await pausa();
  }
  return null;
}
