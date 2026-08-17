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
    // Decodifica ANTES de pontuar: o vocabulário é testado contra o texto, e "&aacute;rea"
    // não casa com /área/. O primeiro lote da PECINI com descrição de corpo veio gravado
    // "confrontando ... a &aacute;rea verde" — o bloco entrou por outros sinais, mas um
    // texto cujo único sinal fosse a área acentuada teria sido descartado como não-imóvel.
    .map(b => decodificarEntidades(b.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
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
  // Decodifica antes de medir: `100 m&sup2;` e `&aacute;rea constru&iacute;da` são a mesma
  // informação que `100 m²` e `área construída`, e só a segunda forma casa com as regras.
  const t = decodificarEntidades(texto).replace(/\s+/g, ' ');
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
const ENTIDADES_NOMEADAS = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  // Latin-1 acentuada — a forma que o Pecini (e todo site que salva em ISO) publica.
  aacute: '\u00e1', agrave: '\u00e0', acirc: '\u00e2', atilde: '\u00e3', auml: '\u00e4', aring: '\u00e5',
  eacute: '\u00e9', egrave: '\u00e8', ecirc: '\u00ea', euml: '\u00eb',
  iacute: '\u00ed', igrave: '\u00ec', icirc: '\u00ee', iuml: '\u00ef',
  oacute: '\u00f3', ograve: '\u00f2', ocirc: '\u00f4', otilde: '\u00f5', ouml: '\u00f6',
  uacute: '\u00fa', ugrave: '\u00f9', ucirc: '\u00fb', uuml: '\u00fc',
  ccedil: '\u00e7', ntilde: '\u00f1', yacute: '\u00fd',
  Aacute: '\u00c1', Agrave: '\u00c0', Acirc: '\u00c2', Atilde: '\u00c3', Auml: '\u00c4',
  Eacute: '\u00c9', Egrave: '\u00c8', Ecirc: '\u00ca', Euml: '\u00cb',
  Iacute: '\u00cd', Igrave: '\u00cc', Icirc: '\u00ce', Iuml: '\u00cf',
  Oacute: '\u00d3', Ograve: '\u00d2', Ocirc: '\u00d4', Otilde: '\u00d5', Ouml: '\u00d6',
  Uacute: '\u00da', Ugrave: '\u00d9', Ucirc: '\u00db', Uuml: '\u00dc',
  Ccedil: '\u00c7', Ntilde: '\u00d1',
  // Símbolos que MUDAM A LEITURA de um número, não só a aparência: `m&sup2;` é a forma
  // HTML mais comum de "m²", e sem esta linha `extrairAreaM2` não enxerga a unidade —
  // a área existe na página e sai 0 do coletor, sem erro nenhum no caminho.
  sup2: '\u00b2', sup3: '\u00b3', ordm: '\u00ba', orda: '\u00aa', deg: '\u00b0',
  frac12: '\u00bd', frac14: '\u00bc', middot: '\u00b7', times: '\u00d7',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', laquo: '\u00ab', raquo: '\u00bb',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022',
  reg: '\u00ae', copy: '\u00a9', trade: '\u2122', euro: '\u20ac', pound: '\u00a3',
};

export function decodificarEntidades(txt) {
  return String(txt || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    // Nomeadas por TABELA, e o `&amp;` por último na tabela não importa: cada entidade é
    // substituída uma vez só, então "&amp;aacute;" não vira "á" por dupla passagem.
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,7});/g, (m, nome) => {
      if (Object.prototype.hasOwnProperty.call(ENTIDADES_NOMEADAS, nome)) return ENTIDADES_NOMEADAS[nome];
      const min = nome.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTIDADES_NOMEADAS, min) ? ENTIDADES_NOMEADAS[min] : m;
    });
}
