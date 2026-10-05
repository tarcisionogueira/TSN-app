/**
 * VALOR DA 2ª PRAÇA LIDO DO EDITAL (05/10, pendência #37)
 *
 * Fora da Caixa, só o MEGA traz o lance mínimo da 2ª praça na listagem: os outros scrapers
 * colapsam as praças num valor só. Mas o edital judicial publica a regra, quase sempre assim:
 *   "em segundo leilão, pelo maior lance, desde que não inferior a 50% (cinquenta por cento)
 *    do valor da avaliação"
 * Um extrator só, sobre o texto do edital, cobre todas as fontes de uma vez.
 *
 * Guardas (o número tem de ser o da 2ª praça, não outro percentual do edital):
 *  - âncora: "2º/segundo/2ª/segunda leilão|praça|hasta" até 400 caracteres ANTES do percentual;
 *  - o percentual tem de ser seguido de "avaliação" (ou "valor atualizado da avaliação") — exclui
 *    sinal ("25% do lance"), comissão ("5% sobre a arrematação") e parcela;
 *  - faixa plausível: 20% a 95%. Em edital de VÁRIOS lotes vale só o percentual (é regra comum a
 *    todos); valor em R$ só é aceito em edital de lote único e abaixo do lance da 1ª praça.
 * Devolve `{ pct, valor, trecho }` ou null — null é "não achei", nunca "não existe 2ª praça".
 */
const ANCORA = /(?:2\s*[ºo°ª]|segund[oa])\s*(?:leil[aã]o|pra[cç]a|hasta|lei[lç]ão)/gi;
const PCT_AVALIACAO = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:\([^)]{0,40}\))?\s*(?:d[oa]|sobre\s+o)?\s*(?:(?:valor|pre[cç]o)\s+)?(?:(?:atualizad[oa]|m[ií]nimo)\s+)?(?:d[ae]\s+)?(?:sua\s+|respectiva\s+)?avalia[cç][aã]o/i;
const REAIS = /R\$\s*([\d.]{1,15},\d{2})/;

const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));

export function extrairSegundaPraca(texto, { multiLote = false, valorAvaliacao = null, valorMinimo = null } = {}) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (!t) return null;
  ANCORA.lastIndex = 0;
  let m;
  while ((m = ANCORA.exec(t))) {
    const janela = t.slice(m.index, m.index + 400);
    const p = janela.match(PCT_AVALIACAO);
    // Regra POR CATEGORIA ("a) Veículos automotores: mínimo de 50%… b) Imóveis: 60%", LJUD): o
    // percentual achado pode ser o de veículo. Com "veículo" entre a âncora e o número, não vale.
    if (p && /ve[íi]culo|automotor|bens m[óo]veis/i.test(janela.slice(0, p.index || 0))) continue;
    if (p) {
      const pct = num(p[1]);
      if (pct >= 20 && pct <= 95) {
        const valor = Number(valorAvaliacao) > 0 ? Math.round(Number(valorAvaliacao) * pct) / 100 : null;
        return { pct, valor, trecho: janela.slice(0, Math.min(janela.length, (p.index || 0) + p[0].length)).slice(0, 240) };
      }
    }
    if (!multiLote) {
      const r = janela.slice(0, 220).match(REAIS);
      const v = r ? num(r[1]) : null;
      const v1 = Number(valorMinimo) || null, aval = Number(valorAvaliacao) || null;
      // Valor em reais: só se cair ABAIXO da 1ª praça e acima de 20% da avaliação (quando
      // conhecidas) — sem os dois referenciais, um R$ solto no trecho não é aceito.
      if (v && v1 && v < v1 && (!aval || v >= aval * 0.2)) {
        return { pct: aval ? Math.round((v / aval) * 1000) / 10 : null, valor: v, trecho: janela.slice(0, 240) };
      }
    }
  }
  return null;
}
