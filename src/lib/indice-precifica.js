/**
 * UMA regra, um lugar: o Índice BidPro NESTE NÍVEL pode virar o valor de mercado do lote?
 *
 * 09/09 — dois relatórios do mesmo dia, os dois com o Índice em nível ESTADO:
 *   • Santa Mônica / Belo Horizonte, apto 44,98 m² → R$ 157.880 contra avaliação de R$ 301.000
 *     (48% ABAIXO), a partir de R$ 3.900/m² e 17 amostras;
 *   • São Joaquim de Bicas/MG, casa 127,24 m²     → R$ 480.967 contra avaliação de R$ 196.000
 *     (145% ACIMA), a partir de R$ 4.200/m² e 15 amostras.
 * O MESMO índice, no MESMO estado, errou 48% para baixo num caso e 145% para cima no outro —
 * porque 15 e 17 amostras para MINAS GERAIS INTEIRO não distinguem um bairro de Belo Horizonte
 * de uma cidade de 30 mil habitantes. O número existia, era plausível, e media outra coisa:
 * é a forma nº 10 do CLAUDE.md ("o instrumento mede uma coisa e reporta com o nome de outra").
 *
 * E o dano NÃO é o texto do relatório. `valorMercado` alimenta o TETO DE LANCE e o ROI —
 * no caso de BH, teto de R$ 92.310 calculado sobre a média de um estado inteiro. É a saída
 * mais perigosa que a plataforma produz: o cliente dá lance em cima dela.
 *
 * ALLOWLIST, não denylist, e isso importa: `indice_bidpro_regiao` também devolve o nível
 * `'uf'` — a MESMA coisa que 'estado' com outra etiqueta, e `lerIndiceBidPro` repassa o retorno
 * do RPC verbatim. Uma lista de proibidos com 'estado' dentro deixaria 'uf' precificando, e o
 * defeito voltaria pela porta de trás. Nível desconhecido (rótulo novo, RPC alterado) também
 * NÃO precifica: "não sei o escopo deste número" é motivo para não usá-lo como preço, nunca
 * para usá-lo assim mesmo.
 *
 * Nível amplo continua APARECENDO no relatório — como faixa de referência da região, com o
 * número de amostras à vista. O que ele não faz mais é virar preço.
 */
export const NIVEIS_QUE_PRECIFICAM = ['bairro', 'grid', 'cidade'];

/** true = este índice pode sustentar o valor de mercado do lote. */
export function indicePrecifica(indice) {
  if (!(Number(indice?.venda_m2) > 0)) return false;
  return NIVEIS_QUE_PRECIFICAM.includes(String(indice?.nivel || '').trim().toLowerCase());
}

/** true = há índice, mas o escopo dele é largo demais para precificar (só serve de contexto). */
export function indiceApenasContexto(indice) {
  return Number(indice?.venda_m2) > 0 && !indicePrecifica(indice);
}

/** Rótulo legível do escopo, para a tela e para o texto do relatório. */
export function rotuloNivelIndice(nivel) {
  const n = String(nivel || '').trim().toLowerCase();
  if (n === 'bairro') return 'bairro';
  if (n === 'grid') return 'entorno';
  if (n === 'cidade') return 'cidade';
  if (n === 'estado' || n === 'uf') return 'estado';
  return n || 'indefinido';
}
