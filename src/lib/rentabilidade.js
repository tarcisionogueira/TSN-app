/**
 * ALUGUEL-ALVO DE 1% AO MÊS — a régua da intenção "locação", do lado do dinheiro.
 *
 * POR QUE ESTE ARQUIVO EXISTE (28/08, decisão do dono): a intenção "locação" já filtra o tipo
 * do imóvel, mas não dizia NADA sobre renda — e a regra do negócio é "1% ao mês sobre o valor
 * investido". Ela não pode virar FILTRO de busca: o acervo só conhece aluguel de mercado em
 * 44 dos 29.447 lotes ativos, então filtrar por rendimento real esconderia 99,8% do material.
 * O que ela pode ser, e é isto, é um ALVO calculado a partir do que o acervo SEMPRE tem — o
 * lance mínimo: "para render 1% a.m., este lote precisaria alugar por R$ X".
 *
 * ⚠️ É ALVO, NÃO PREVISÃO. Não afirmamos que o imóvel aluga por esse valor; afirmamos quanto
 * ele PRECISARIA render para bater a régua. Quem compara com o aluguel real da região é o
 * relatório mercadológico, onde o número existe. Qualquer tela que exiba isto tem que dizer a
 * premissa junto — número sem premissa vira número mágico, e número mágico vira reclamação.
 *
 * A RÉGUA DE CUSTO É ÚNICA E MORA AQUI. Antes deste arquivo o projeto tinha TRÊS: 5%+5% no
 * relatório (`src/pages/Analise.jsx`), 9,5% na simulação rápida da ficha e 5%+3% no registro
 * que a Busca semeia ao marcar "Arrematei". Três réguas para o mesmo custo é a forma que esta
 * base cataloga — o relatório é a autoridade (é o que o cliente paga para ler), então é o
 * 5% + 5% dele que vale, e as outras passam a importar daqui.
 *
 * A regra também é DECLARADA no banco (`regra_negocio` + `public.aluguel_alvo_mensal`) e
 * `npm run verificar:regras` compara as duas no CI, pelo mesmo motivo de `intencao.js`.
 */

// Comissão do leiloeiro. Padrão do mercado e default do relatório (`Analise.jsx`).
export const COMISSAO_LEILOEIRO_PCT = 5;
// ITBI + registro somados. Varia por município; 5% é o default do relatório.
export const ITBI_REGISTRO_PCT = 5;
// O investido é o lance MAIS os custos para o imóvel ficar no seu nome.
export const CUSTO_AQUISICAO_PCT = COMISSAO_LEILOEIRO_PCT + ITBI_REGISTRO_PCT; // 10%
// A régua: 1% do investido, por mês.
export const ALUGUEL_ALVO_PCT_MES = 1;

export const PREMISSAS_TEXTO =
  `lance + comissão do leiloeiro (${COMISSAO_LEILOEIRO_PCT}%) + ITBI/registro (${ITBI_REGISTRO_PCT}%)`;

/** Quanto sai do bolso para o imóvel ficar no seu nome. `null` quando não há lance. */
export function investidoTotal(lance) {
  const v = Number(lance);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v * (1 + CUSTO_AQUISICAO_PCT / 100);
}

/**
 * Aluguel mensal que faria o lote render 1% a.m. sobre o investido.
 * Devolve `null` — e não 0 — quando não há lance: zero seria um número, e número é resposta.
 */
export function aluguelAlvoMensal(lance) {
  const investido = investidoTotal(lance);
  return investido === null ? null : investido * (ALUGUEL_ALVO_PCT_MES / 100);
}
