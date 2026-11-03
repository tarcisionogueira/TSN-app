// VALOR DE MERCADO SEM ÁREA NÃO É VALOR (03/11).
//
// Caso real (análise a3ce7044, cliente explorador, 28/10): sala comercial em BH, Av. Afonso Pena 578, sem
// metragem no acervo nem no documento. As duas primeiras gerações saíram "sem estimativa de mercado
// (12/25 comparáveis, sem área do imóvel)" — o certo. Na regeneração automática a IA preencheu
// `valorEstimadoImovel: 451.000` (R$ 4.521/m² × uns 100 m² que não existem em lugar nenhum) contra uma
// avaliação de R$ 100.000, e o servidor aceitava o número da IA sem conferir a área. O relatório deixou
// de contar como vazio, a cota não foi estornada e a viabilidade saiu calculada sobre 4,5× a avaliação.
//
// Regra: nas bases POR M² (residencial, comercial, industrial), sem área conhecida o valor da IA é
// descartado. O relatório sai sem valor de mercado (estorna a cota, a tela pede a metragem). Bases que
// não dependem de m² construído (terreno, rural, unidade/vaga) seguem como antes.

export const BASES_POR_M2 = ['residencial', 'comercial', 'industrial'];

/**
 * Devolve o valor da IA que pode ser usado, ou 0. `descartado` traz o número recusado para diagnóstico.
 */
export function valorDaIaUtilizavel({ valorIa, areaM2, baseTipo }) {
  const v = Number(valorIa) || 0;
  if (!(v > 0)) return { valor: 0, descartado: null };
  if (BASES_POR_M2.includes(baseTipo) && !(Number(areaM2) > 0)) {
    return { valor: 0, descartado: { valorIa: Math.round(v), motivo: 'area_desconhecida' } };
  }
  return { valor: Math.round(v), descartado: null };
}
