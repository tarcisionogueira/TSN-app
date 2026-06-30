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
