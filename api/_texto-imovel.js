/**
 * TEXTO DO IMÓVEL — descrição e metragem a partir do HTML/texto de uma página de lote.
 *
 * Mora em `api/` porque é usado dos DOIS lados: pelos coletores (scripts/lib/scraper-core.mjs,
 * que reexporta) e pelo enriquecedor sob demanda (api/enriquecer-lote.js). A direção
 * scripts → api é a convenção do repo (ver scripts/captura-documentos.mjs importando
 * api/_brightdata.js); api → scripts não existe em lugar nenhum, e inaugurá-la arriscaria o
 * bundle da Vercel não incluir `scripts/` na função. Uma definição só, no lado que os dois
 * alcançam.
 */
// Vocabulário que só aparece em descrição de IMÓVEL — não em texto institucional de leiloeiro.
// `matrícula`/`confront` são os mais decisivos: nenhum blurb de marketing os usa.
const RE_VOCAB_IMOVEL = /\b(m²|m2|metros?\s+quadrados?|área\s+(constru[íi]da|privativa|total|do\s+terreno|útil)|dormit[óo]rio|quarto|su[íi]te|banheiro|garagem|vaga|edif[íi]ca|benfeitoria|matr[íi]cula|confront|lote\s+n|quadra\s+n|pavimento|c[oô]modo)/i;
// SINAL FORTE: só aparece quando o texto DESCREVE o bem. Exigir um destes é o que separa a
// descrição verdadeira de uma linha de menu — no teste, "Confira nossos imóveis disponíveis
// com vaga de garagem no portal" passava com dois termos ("vaga" e "garagem") que são o mesmo
// conceito. Contar sinais distintos não basta se os sinais forem fracos e correlacionados.
// Note o número ANTES da unidade: "m²" solto num filtro de busca não conta; "198,45 m²" conta.
const RE_SINAL_FORTE = /(\d[\d.,]*\s*(m²|m2|metros?\s+quadrados?)|área\s+(constru[íi]da|privativa|total|do\s+terreno|útil)|matr[íi]cula\s*n?[º°]?\s*[\d.]|confront|edif[íi]ca|benfeitoria|lote\s+n[º°]?\s*[\d.]|quadra\s+n[º°]?\s*[\d.])/i;
// Ruído institucional: se o bloco é sobre o LEILOEIRO e não sobre o imóvel, descarta.
const RE_RUIDO_SITE = /(especialistas?\s+em\s+leil|cadastre-se|fale\s+conosco|pol[íi]tica\s+de\s+privacidade|todos\s+os\s+direitos\s+reservados|siga-nos|newsletter)/i;

/**
 * Melhor bloco de texto do CORPO que descreve o imóvel, ou null.
 *
 * Estratégia deliberadamente simples e sem dependência de seletor por site: derruba
 * script/style/nav/header/footer, quebra o que sobrou em blocos, e escolhe o bloco com
 * vocabulário de imóvel MAIS informativo (mais termos distintos; empate desempata pelo maior).
 * Sem seletor específico porque não temos acesso de rede aos sites daqui — e regra por
 * leiloeiro seria justamente o que faz cada fonte precisar de manutenção própria.
 */
export function extrairDescricaoDoCorpo(html) {
  if (!html || typeof html !== 'string') return null;
  const corpo = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|select)[\s\S]*?<\/\1>/gi, ' ');
  // Quebra por tags de bloco: cada pedaço é um candidato independente.
  const blocos = corpo
    .split(/<\/(?:p|div|li|td|section|article|h[1-6])>/i)
    .map(b => b.replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/\s+/g, ' ').trim())
    .filter(b => b.length >= 60 && b.length <= 4000 && !RE_RUIDO_SITE.test(b));

  let melhor = null, melhorPontos = 0;
  for (const b of blocos) {
    // Sem sinal FORTE não há candidato — ver a nota em RE_SINAL_FORTE.
    if (!RE_SINAL_FORTE.test(b)) continue;
    if (!RE_VOCAB_IMOVEL.test(b)) continue;
    // Pontuação = quantos termos DISTINTOS do vocabulário aparecem. Mede densidade de
    // informação, não tamanho: um rodapé longo com um "m²" solto perde para uma descrição
    // curta que traz área, dormitório e matrícula.
    const termos = new Set((b.match(new RegExp(RE_VOCAB_IMOVEL.source, 'gi')) || []).map(t => t.toLowerCase()));
    const pontos = termos.size;
    if (pontos > melhorPontos || (pontos === melhorPontos && melhor && b.length > melhor.length)) {
      melhor = b; melhorPontos = pontos;
    }
  }
  // Um único termo pode ser coincidência (ex.: "vaga" num menu). Exige DOIS sinais distintos
  // para substituir a meta tag — abaixo disso, "não sei" é resposta melhor que um palpite.
  return melhorPontos >= 2 ? melhor.slice(0, 2000) : null;
}

/**
 * METRAGEM a partir de texto livre (descrição/página), ou 0.
 *
 * Por que existe (17/08): os coletores faziam cada um o seu `texto.match(/(\d+)\s*m²/)`, com
 * dois defeitos iguais em todos. (a) Exigiam o caractere `m²` — site que escreve "m2" ou
 * "metros quadrados" saía sem área. (b) Pegavam a PRIMEIRA ocorrência da página, que num
 * portal de leilão costuma ser o filtro de busca ("imóveis a partir de 50 m²") e não o imóvel.
 *
 * A ordem aqui é por CONFIANÇA, não por posição no texto: área rotulada
 * (construída/privativa/edificada) vence área solta, e área solta só é aceita dentro de faixa
 * plausível. Terreno vem por último de propósito — quando existem as duas, a área da
 * EDIFICAÇÃO é a que baliza o R$/m² do relatório (ver `gerar-documental.js`).
 */
export function extrairAreaM2(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (!t) return 0;
  const UNI = '(?:m²|m2|mts²|metros?\\s+quadrados?)';
  const NUM = '(\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const paraNumero = (s) => {
    if (!s) return 0;
    // "1.234,56" (pt-BR) vs "1234.56": só trata o ponto como milhar quando há vírgula decimal.
    const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  const plausivel = (v) => (v >= 8 && v <= 1_000_000 ? v : 0);
  const tentativas = [
    new RegExp(`área\\s+(?:constru[íi]da|privativa|edificada|útil)[^\\d]{0,20}${NUM}\\s*${UNI}`, 'i'),
    new RegExp(`${NUM}\\s*${UNI}\\s+de\\s+área\\s+(?:constru[íi]da|privativa|edificada|útil)`, 'i'),
    new RegExp(`área\\s+total[^\\d]{0,20}${NUM}\\s*${UNI}`, 'i'),
    new RegExp(`área\\s+do\\s+terreno[^\\d]{0,20}${NUM}\\s*${UNI}`, 'i'),
    new RegExp(`${NUM}\\s*${UNI}`, 'i'), // solta, último recurso
  ];
  for (const re of tentativas) {
    const v = plausivel(paraNumero((t.match(re) || [])[1]));
    if (v) return v;
  }
  return 0;
}

/**
 * Decodifica entidades HTML (&#xE3; &#227; &amp; &nbsp;) em texto já sem tags.
 *
 * Existe porque a falta disto NÃO aparece como erro — aparece como classificação errada.
 * Achado em 17/08: `scripts/scraper-pecini.mjs` classifica o anexo testando /matr[íi]cul/
 * contra o rótulo CRU do link. Um link rotulado "Matr&#xED;cula" nunca casa (depois de
 * "Matr" vem "&#xED;", não "í") e o documento vira 'anexo' genérico — ou some. A prova está
 * no acervo: o anexo gravado se chama literalmente "Edital do Leil&#xE3;o".
 * O cliente lia isso na ficha, e a matrícula que existe no site do leiloeiro não chegava aqui.
 */
export function decodificarEntidades(txt) {
  return String(txt || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
