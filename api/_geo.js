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
import { registrarUso } from './_uso.js';

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
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
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
    // class=place/highway/building são coordenadas úteis; evita resultados vagos.
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch { return null; }
}

// GOOGLE GEOCODING — padrão-ouro de precisão no Brasil. Ativado (GOOGLE_MAPS_API_KEY
// configurada no Vercel). Só roda se houver a chave; crédito grátis mensal cobre. Devolve o
// nível conforme a precisão (ROOFTOP/RANGE = endereço exato). É a 1ª opção da
// cascata; sem a chave, cai no Nominatim normalmente.
export async function googleGeocode(enderecoCompleto) {
  const key = (process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  if (!key || !enderecoCompleto || !enderecoCompleto.trim()) return null;
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
export async function geocodificarCascata(im, { deadline = Infinity, sleepMs = 1100 } = {}) {
  const { endereco, bairro, cidade, estado, cep } = im;
  const ufNome = UFS[String(estado || '').trim().toUpperCase()]?.nome || estado;
  const aceita = (c) => (c && coordValida(c.lat, c.lng, estado, cidade) ? c : null);
  const pausa = () => (sleepMs > 0 ? sleep(sleepMs) : Promise.resolve());

  // Nível 0 — GOOGLE (mais preciso no Brasil). Endereço completo em texto; o Google
  // lida bem com "Lt/Qd/Apto" e nomes de condomínio. Validado contra o IBGE.
  const { via, numero } = parseLogradouro(endereco);
  const enderecoGoogle = [
    [via, numero].filter(Boolean).join(', ') || endereco,
    bairro, cidade, estado ? `${estado}` : '', cep ? `CEP ${cep}` : '', 'Brasil',
  ].filter(Boolean).join(', ');
  if (Date.now() < deadline) {
    const g = aceita(await googleGeocode(enderecoGoogle));
    if (g) return { ...g, cep: cep || null };
  }

  // Nível 0.5 — GEOCODER PAGO (LocationIQ), pronto para ativar via GEOCODER_KEY.
  // Sem a chave é no-op. Roda depois do Google e antes das rotas públicas do
  // Nominatim, pois quando ativo é mais confiável que os provedores gratuitos.
  if (Date.now() < deadline) {
    const p = aceita(await geocoderPago(enderecoGoogle));
    if (p) return { ...p, cep: cep || null };
  }

  // Nível 1 — logradouro + número (estruturado + validação IBGE).
  let cepEnc = null;
  if (via && Date.now() < deadline) {
    const street = [via, numero].filter(Boolean).join(' ');
    const c = aceita(await nominatimEstruturado({ street, city: cidade, state: ufNome }));
    if (c) return { ...c, nivel: numero ? 'endereco' : 'rua' };
    await pausa();
    // Recuperação via Correios: canoniza o logradouro e tenta de novo.
    if (Date.now() < deadline) {
      const via2 = await viacepCanonico(estado, cidade, via);
      if (via2?.logradouro) {
        cepEnc = via2.cep || null;
        const street2 = [via2.logradouro, numero].filter(Boolean).join(' ');
        const c2 = aceita(await nominatimEstruturado({ street: street2, city: cidade, state: ufNome }));
        if (c2) return { ...c2, nivel: numero ? 'endereco' : 'rua', cep: cepEnc };
        await pausa();
      }
    }
    // Nível 1.2 — TEXTO LIVRE no Nominatim (grátis). A busca estruturada quebra com
    // endereço sujo ("Lt/Qd/Apto"); o parser de texto livre costuma acertar a rua.
    if (Date.now() < deadline) {
      const ql = [[via, numero].filter(Boolean).join(' '), bairro, cidade, ufNome, 'Brasil'].filter(Boolean).join(', ');
      const cl = aceita(await nominatimTextoLivre(ql));
      if (cl) return { ...cl, nivel: numero ? 'endereco' : 'rua', cep: cepEnc };
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
    const cb = aceita(await brasilapiCep(cepLimpo));
    if (cb) return { ...cb, nivel: 'rua', cep: cepLimpo };
    const c = aceita(await nominatimEstruturado({ postalcode: cepLimpo, city: cidade, state: ufNome }));
    if (c) return { ...c, nivel: 'rua', cep: cepLimpo };
    await pausa();
  }

  // Nível 1.6 — sem CEP conhecido, mas com bairro: tenta o ViaCEP pelo BAIRRO
  // para descobrir um CEP da região (melhor que o centróide do bairro inteiro).
  if (!cepLimpo && bairro && bairro.trim() && cidade && Date.now() < deadline) {
    const viaB = await viacepCanonico(estado, cidade, bairro);
    const cepB = String(viaB?.cep || '').replace(/\D/g, '');
    if (cepB.length === 8 && Date.now() < deadline) {
      const c = aceita(await nominatimEstruturado({ postalcode: cepB, city: cidade, state: ufNome }));
      if (c) return { ...c, nivel: 'bairro', cep: cepB };
      await pausa();
    }
  }

  // Nível 2 — bairro.
  if (bairro && bairro.trim() && Date.now() < deadline) {
    const c = aceita(await nominatimEstruturado({ street: bairro, city: cidade, state: ufNome }));
    if (c) return { ...c, nivel: 'bairro', cep: cepEnc };
    await pausa();
  }

  // Nível 3 — cidade: centróide IBGE (instantâneo, sempre na UF certa).
  const cen = centroideIBGE(cidade, estado);
  if (cen) return { lat: cen.lat, lng: cen.lng, nivel: 'cidade', cep: cepEnc };

  // Último recurso: cidade via Nominatim (cidades fora do IBGE local).
  if (cidade && cidade.trim() && Date.now() < deadline) {
    const c = aceita(await nominatimEstruturado({ city: cidade, state: ufNome }));
    if (c) return { ...c, nivel: 'cidade', cep: cepEnc };
    await pausa();
  }
  return null;
}
