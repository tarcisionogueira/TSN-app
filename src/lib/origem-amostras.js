// DE ONDE VIERAM OS COMPARÁVEIS — cidade da amostra × cidade do imóvel (03/11).
//
// Caso Peruíbe (análise 57573ba9): níveis 1 e 2 vazios, e o nível 3 trouxe 3 anúncios de São Paulo
// (Jd. Itapemirim, Vila Aricanduva) e de Bauru, com `distanciaKm: 0`. A régua do m² não conferia cidade
// — e distância 0 ainda deu a eles o peso MÁXIMO. O relatório escreveu "Média de 3 comparáveis do mesmo
// tipo/região", citou recortes de ~1 km e carimbou "Operação viável, vale avançar".
//
// Amostra sem cidade identificável NÃO é descartada (a maioria vem só com bairro): só sai o que
// NOMEIA outra cidade. O descarte é por prova, não por ausência de dado.

const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

export const normCidade = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Cidade como está ESCRITA no endereço da amostra ("Bairro - Cidade - UF", "Cidade/UF", "Cidade - UF"), ou null. */
export function cidadeEscritaDaAmostra(a) {
  const e = String(a?.endereco || a?.cidade || '').trim();
  if (!e) return null;
  if (a?.cidade && !a?.endereco) return String(a.cidade).trim() || null;
  const partes = e.split(/\s+-\s+|,\s*/).map(s => s.trim()).filter(Boolean);
  const ult = partes[partes.length - 1] || '';
  const mBarra = ult.match(/^(.+?)\s*\/\s*([A-Za-z]{2})$/);
  if (mBarra && UFS.has(mBarra[2].toUpperCase())) return mBarra[1].trim() || null;
  if (UFS.has(ult.toUpperCase()) && partes.length >= 2) return partes[partes.length - 2] || null;
  return null;
}

/** A mesma cidade, normalizada para comparar (sem acento, minúscula). */
export function cidadeDaAmostra(a) {
  return normCidade(cidadeEscritaDaAmostra(a)) || null;
}

/** true = outra cidade comprovada; false = mesma cidade ou sem dado para dizer. */
export function ehOutraCidade(a, cidadeImovel) {
  const alvo = normCidade(cidadeImovel);
  const c = cidadeDaAmostra(a);
  return !!(alvo && c && c !== alvo);
}

// Abaixo disto em comparáveis LOCAIS, o selo não pode dizer "viável, vale avançar".
export const MIN_COMPARAVEIS_LOCAIS = 3;

/**
 * Resumo da base de venda do relatório. Usa o campo gravado pelo servidor (`mercado.baseLocal`) quando
 * existe; em relatório antigo, recalcula das amostras gravadas — mesma régua, sem IA.
 */
export function baseLocalDe(mercado, cidadeImovel, vendas) {
  if (mercado?.baseLocal && typeof mercado.baseLocal === 'object') return mercado.baseLocal;
  const xs = Array.isArray(vendas) ? vendas : [];
  const foraDaCidade = xs.filter(a => ehOutraCidade(a, cidadeImovel));
  const cidades = [...new Set(foraDaCidade.map(cidadeEscritaDaAmostra).filter(Boolean))];
  const locais = xs.length - foraDaCidade.length;
  return { locais, foraDaCidade: foraDaCidade.length, cidadesFora: cidades, suficiente: locais >= MIN_COMPARAVEIS_LOCAIS };
}
