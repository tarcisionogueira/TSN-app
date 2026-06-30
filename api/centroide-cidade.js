/**
 * GET /api/centroide-cidade?cidade=Santana de Parnaíba&uf=SP
 * Devolve o centróide oficial IBGE da cidade ({ lat, lng }). Usado pelo mapa da
 * busca como fallback CONFIÁVEL de auto-zoom: quando os imóveis filtrados ainda
 * não têm coordenada (não geocodificados), o mapa precisa pelo menos focar na
 * cidade — sem depender do Nominatim (que é bloqueado/instável).
 *
 * Sem rede: lê de _municipios.js (centróides embarcados dos 5570 municípios).
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

import MUNICIPIOS from './_municipios.js';

// Normaliza igual à CHAVE de _municipios.js: minúscula, sem acento/cedilha,
// mantendo espaços e colapsando múltiplos. "Santana de Parnaíba" → "santana de parnaiba".
const normNomeMun = (c) => (c || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export default function handler(req, res) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const cidade = params.get('cidade') || '';
  const uf = (params.get('uf') || '').toUpperCase().trim();
  if (!cidade || !uf) { res.status(400).json({ error: 'cidade e uf obrigatórios' }); return; }

  const nome = normNomeMun(cidade);
  const chave = `${uf}|${nome}`;
  let coord = MUNICIPIOS[chave];

  // Tolerância a pequenas variações de grafia: tenta sem o sufixo " do/de X" não é
  // necessário; mas cobre o caso de "d'" virando espaço duplicado já tratado acima.
  if (!coord) {
    // Busca por prefixo na mesma UF (cobre abreviações tipo "Sant Ana" vs "Santana").
    const cand = Object.keys(MUNICIPIOS).find(k => k.startsWith(`${uf}|`) && k.slice(uf.length + 1).replace(/\s/g, '') === nome.replace(/\s/g, ''));
    if (cand) coord = MUNICIPIOS[cand];
  }

  if (!coord || !Array.isArray(coord)) { res.status(404).json({ error: 'Cidade não encontrada' }); return; }
  res.status(200).json({ ok: true, lat: coord[0], lng: coord[1], cidade, uf });
}
