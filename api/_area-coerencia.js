// QUANDO A AVALIAÇÃO DESTOA, E NÃO A ÁREA (04/11, Porto Trapiche/Salvador, PATIOROCHALEIL 5e8f4d8d).
//
// A trava de coerência do mercadológico (api/gerar-analise.js) vê comparáveis acima de 3× o R$/m² implícito
// na avaliação e conclui que a ÁREA do anúncio é a total/terreno — então ancora o valor na avaliação. No caso
// real: 4 apartamentos UNIFICADOS (111–114), ~700 m², 5 suítes; 5 comparáveis do PRÓPRIO condomínio a
// ~R$ 32 mil/m²; avaliação judicial (processo de 2019) a R$ 6,5 mil/m². A trava inferiu "~136 m² privativos"
// para um imóvel de cinco suítes e o relatório saiu com mercado = avaliação. Ali quem destoa é a avaliação.
//
// Este módulo decide, só com o texto do próprio lote, quando a área está CORROBORADA (e a avaliação é que
// está defasada), e aplica o fator de área da NBR 14653-2 para não precificar uma unidade grande pelo R$/m²
// de unidades pequenas (o m² cai com o tamanho).

const NUM = { um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

/** Maior número de quartos/dormitórios/suítes que o texto afirma, ou 0. */
export function quartosDoTexto(texto) {
  const t = String(texto || '').toLowerCase();
  let max = 0;
  for (const m of t.matchAll(/\b(\d{1,2}|um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:\(\w+\)\s+)?(quartos?|dormit[óo]rios?|su[íi]tes?)\b/g)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (NUM[m[1]] || 0);
    if (n > 0 && n <= 20) max = Math.max(max, n);
  }
  return max;
}

/**
 * A área do anúncio é sustentada pelo próprio lote? `areaPrivImplicita` = avaliação ÷ R$/m² dos comparáveis
 * (o que a trava acharia que é a área "real").
 */
export function areaCorroborada({ texto, areaPrivImplicita }) {
  const t = String(texto || '');
  const motivos = [];
  if (/unifica[çc][ãa]o|unificad[oa]s?\b|jun[çc][ãa]o\s+d[eo]s?\s+(?:apartamentos|unidades)/i.test(t)) motivos.push('unidades unificadas no texto do lote');
  const q = quartosDoTexto(t);
  // Piso generoso: 20 m² de sala/serviço + 22 m² por dormitório. Abaixo disso, a "área implícita" não cabe
  // no imóvel que o texto descreve.
  if (q >= 2 && areaPrivImplicita > 0 && areaPrivImplicita < 20 + 22 * q) motivos.push(`${q} dormitórios não cabem em ~${Math.round(areaPrivImplicita)} m²`);
  return { corroborada: motivos.length > 0, motivos };
}

/**
 * Fator de área (NBR 14653-2, homogeneização por área): (área do comparável ÷ área do avaliando)^(1/4) quando
 * a diferença passa de 30%. Só REDUZ (avaliando maior que o comparável) — nunca infla. Piso 0,5.
 */
export function fatorArea(areaComparavel, areaAvaliando) {
  const ac = Number(areaComparavel) || 0, aa = Number(areaAvaliando) || 0;
  if (!(ac > 0 && aa > 0)) return 1;
  const r = ac / aa;
  if (r >= 0.77) return 1;
  return Math.max(0.5, Math.round(r ** 0.25 * 1000) / 1000);
}

/** Mediana da área dos comparáveis (m² gravado, ou valor ÷ valorM2 quando só o preço/m² veio). */
export function areaMedianaComparaveis(vendas) {
  const areas = (Array.isArray(vendas) ? vendas : []).map((v) => {
    const m2 = Number(v?.m2 || v?.area || v?.areaM2) || 0;
    if (m2 > 0) return m2;
    const val = Number(v?.valor || v?.valorTotal) || 0, pm2 = Number(v?.valorM2 || v?.precoM2) || 0;
    return val > 0 && pm2 > 0 ? val / pm2 : 0;
  }).filter((a) => a >= 15 && a <= 100000).sort((a, b) => a - b);
  if (!areas.length) return 0;
  const k = Math.floor(areas.length / 2);
  return Math.round(areas.length % 2 ? areas[k] : (areas[k - 1] + areas[k]) / 2);
}
