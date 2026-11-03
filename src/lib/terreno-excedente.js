// TERRENO EXCEDENTE — detecção determinística (03/11).
//
// Caso Itu (análise 9ba1ce0c): casa de 219,5 m² construídos num terreno de 3.017,50 m² em condomínio.
// O valor de mercado saiu R$ 10.622/m² × 219,5 m² e `terrenoExcedente` veio `haExcedente: false` — porque
// o excedente só existia quando a IA o preenchia (instrução em texto no prompt), e a conta ponderada por
// cima reescrevia o valor só com a construção. Um lote 14× maior que a casa saía avaliado em zero, e o
// relatório reprovou a operação.
//
// Regra (aprovada pelo dono em 03/11): CASA com terreno acima de 1.000 m² E acima de 3× a área construída.
// O lote "padrão" que já está no preço do m² construído é 3× a construção; o que passa disso é excedente.
// Com preço de terreno do Índice da cidade/bairro (4+ amostras), o excedente entra no valor; sem ele, o
// relatório diz que o terreno NÃO foi avaliado e o veredito vira indicativo.

export const EXCEDENTE_RAZAO = 3;
export const EXCEDENTE_MIN_TERRENO_M2 = 1000;
export const EXCEDENTE_MIN_AMOSTRAS_TERRENO = 4;
const NIVEIS_QUE_PRECIFICAM = new Set(['bairro', 'grid', 'cidade']);

const ehCasa = (tipo) => /casa|sobrado|ch[aá]cara|resid[eê]ncia/i.test(String(tipo || '')) && !/apart|flat|kitnet|studio|cobertura/i.test(String(tipo || ''));

/**
 * `indiceTerreno` = retorno de `lerIndiceBidPro(imDb, 'terreno')` (ou null).
 * Devolve o objeto gravado em `consolidado.terrenoExcedente`.
 */
export function avaliarTerrenoExcedente({ tipo, areaConstruidaM2, areaTerrenoM2, indiceTerreno = null }) {
  const aC = Number(areaConstruidaM2) || 0, aT = Number(areaTerrenoM2) || 0;
  const vazio = { haExcedente: false, areaExcedenteM2: 0, valorTerrenoExcedente: 0 };
  if (!ehCasa(tipo) || !(aC > 0) || !(aT > 0)) return vazio;
  if (aT < EXCEDENTE_MIN_TERRENO_M2 || aT <= EXCEDENTE_RAZAO * aC) return vazio;
  const loteReferenciaM2 = Math.round(EXCEDENTE_RAZAO * aC * 100) / 100;
  const areaExcedenteM2 = Math.round((aT - loteReferenciaM2) * 100) / 100;
  const m2 = Number(indiceTerreno?.venda_m2) || 0;
  const n = Number(indiceTerreno?.n_amostras) || 0;
  const nivel = String(indiceTerreno?.nivel || '');
  const precifica = m2 > 0 && n >= EXCEDENTE_MIN_AMOSTRAS_TERRENO && NIVEIS_QUE_PRECIFICAM.has(nivel);
  if (!precifica) {
    return {
      haExcedente: true, avaliado: false, areaExcedenteM2, loteReferenciaM2, valorTerrenoExcedente: 0,
      motivo: m2 > 0 ? `referência de terreno insuficiente (${n} amostra(s), nível ${nivel || '?'})` : 'sem referência de preço de terreno na região',
    };
  }
  return {
    haExcedente: true, avaliado: true, areaExcedenteM2, loteReferenciaM2,
    precoM2Terreno: m2, nAmostrasTerreno: n, nivelTerreno: nivel,
    valorTerrenoExcedente: Math.round(areaExcedenteM2 * m2),
  };
}

/** Frase para a tela/PDF/metodologia. */
export function fraseTerrenoExcedente(te) {
  if (!te?.haExcedente) return '';
  const f = (x) => Math.round(Number(x) || 0).toLocaleString('pt-BR');
  if (te.avaliado) {
    return `Terreno excedente de ~${f(te.areaExcedenteM2)} m² (acima de ${f(te.loteReferenciaM2)} m², 3× a área construída) avaliado à parte: R$ ${f(te.precoM2Terreno)}/m² de terreno (Índice BidPro, ${te.nivelTerreno}, ${te.nAmostrasTerreno} amostras) = R$ ${f(te.valorTerrenoExcedente)}, somado ao valor da construção.`;
  }
  return `Terreno excedente de ~${f(te.areaExcedenteM2)} m² não avaliado: o valor de mercado considera só a construção e tende a estar subestimado (${te.motivo || 'sem referência de terreno'}).`;
}
