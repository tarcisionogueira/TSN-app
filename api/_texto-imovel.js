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

  // QUALIFICA cada bloco isoladamente (mesmo crivo de sempre: sinal forte + vocabulário).
  const vocabDe = (b) => new Set((b.match(new RegExp(RE_VOCAB_IMOVEL.source, 'gi')) || []).map(t => t.toLowerCase()));
  const qualifica = blocos.map(b => RE_SINAL_FORTE.test(b) && RE_VOCAB_IMOVEL.test(b));

  // ─── PAINEL OFICIAL = SEQUÊNCIA DE BLOCOS, NÃO UM BLOCO SÓ (17/09) ───────────────────────
  // Até aqui só o bloco de MAIOR pontuação isolada virava descrição. Achado no PECINI: o
  // painel "Informações" que o leiloeiro publica (texto do lote → Áreas → Descrição conforme
  // matrícula → nº da matrícula → endereço) vem em VÁRIOS <p>/<li> separados — cada um pode
  // isoladamente ter só 1 termo de vocabulário (não bate o piso de 2), mas JUNTOS descrevem o
  // imóvel de verdade. Ficar só com o vencedor cortava a ficha na 1ª frase e descartava
  // exatamente a parte que vem do trabalho do leiloeiro (medidas, confrontações, matrícula) —
  // que é a mais valiosa para quem analisa e para o diagnóstico da IA.
  //
  // Corrigido reunindo SEQUÊNCIAS de blocos qualificados (tolerando 1 bloco de folga no meio,
  // pra não quebrar por causa de um <div> de UI entre dois parágrafos de conteúdo), em vez de
  // varrer a página inteira: só blocos VIZINHOS entram juntos, então um widget de "imóveis
  // semelhantes" longe dali no HTML não se mistura com a descrição deste lote.
  const GAP_MAX = 1;
  const sequencias = [];
  let atual = null;
  for (let i = 0; i < blocos.length; i++) {
    if (qualifica[i]) {
      if (atual && i - atual.fim - 1 <= GAP_MAX) { atual.fim = i; atual.idx.push(i); }
      else { atual = { inicio: i, fim: i, idx: [i] }; sequencias.push(atual); }
    }
  }

  let melhor = null, melhorPontos = 0;
  for (const seq of sequencias) {
    const termos = new Set();
    for (const i of seq.idx) for (const t of vocabDe(blocos[i])) termos.add(t);
    const pontos = termos.size;
    if (pontos > melhorPontos) {
      melhor = blocos.slice(seq.inicio, seq.fim + 1).join(' ');
      melhorPontos = pontos;
    }
  }
  // Um único termo pode ser coincidência (ex.: "vaga" num menu). Exige DOIS sinais distintos
  // na sequência para substituir a meta tag — abaixo disso, "não sei" é resposta melhor que
  // um palpite.
  // 20/09 (pedido do dono: descrição completa, como o leiloeiro publica): 2000 ainda truncava
  // — CALIL/APICE/TMLEILOES/CRLEILOES/LANCEJA/VEGAS batiam exatamente nesse teto em produção.
  // Coluna `descricao` é `text` no banco, sem limite; os caller sites (scraper-pecini.mjs etc.)
  // também precisam do mesmo teto, senão re-truncam o que este função devolve mais longo agora.
  return melhorPontos >= 2 ? melhor.slice(0, 8000) : null;
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
// Nº DA MATRÍCULA DA UNIDADE (04/10). Descrição de apartamento cita DUAS: a do terreno/condomínio
// ("submetida ao regime de condomínio conforme o registro nº 375 feito na matrícula nº 393.715") e
// a da unidade ("Matrícula nº 460.206 do 11º Cartório de Registro de Imóveis"). Pegar a primeira
// gravou a do prédio inteiro. Vence a que vem com o cartório ao lado; sem isso, a primeira citada
// que não seja a matrícula-mãe ("feito na matrícula" / "na matrícula nº … deste Serviço").
export function numeroMatriculaDoTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const achados = [...t.matchAll(/matr[íi]cula\s*(?:imobili[áa]ria\s*)?:?\s*(?:n[ºo°.]*\s*)?(\d[\d.\-]*\d|\d)/gi)]
    .map((m) => ({ num: m[1], antes: t.slice(Math.max(0, m.index - 25), m.index), depois: t.slice(m.index + m[0].length, m.index + m[0].length + 60) }));
  if (!achados.length) return null;
  // A matrícula-MÃE é descartada ANTES de olhar o cartório: "feito na matrícula nº 393.715 do 11º
  // Cartório" também tem o cartório ao lado (varredura de 04/10).
  const ehMae = (a) => /(?:feito|feita|registrad[oa]|averbad[oa])\s+na\s*$/i.test(a.antes) || /^\s*deste\s/i.test(a.depois);
  const candidatas = achados.filter((a) => !ehMae(a));
  const doCartorio = candidatas.find((a) => /^\s*(?:,|-|–)?\s*(?:do|no|junto ao)\s+(?:\d+\s*[ºª°o]?\s*)?(?:cart[óo]rio|of[íi]cio|registro de im[óo]veis|cri\b|servi[çc]o)/i.test(a.depois));
  if (doCartorio) return doCartorio.num;
  return (candidatas[0] || achados[0]).num;
}

// VÁRIOS BENS NUM LOTE SÓ (28/09). "Lote 1) Terreno … com a área de 1.303,00 m² … Lote 2) Terreno
// … com a área de 1.200,00 m² …" é UM lote de leilão com DOIS terrenos (Embu-Guaçu, LEILAOBRASIL):
// o site grava a área do 1º bem, a matrícula lida é a de um só, e o relatório precificou 1.303 m²
// quando o arrematante leva 2.503 m². Soma só quando TODOS os bens enumerados têm área legível —
// um bem sem área faria a soma parecer completa e sair menor que a verdade.
// Devolve `{ soma, partes }` (partes = área de cada bem) ou null quando não é multi-bem.
export function somaAreasMultiBem(texto) {
  const t = decodificarEntidades(String(texto || '')).replace(/\s+/g, ' ');
  const cortes = [...t.matchAll(/\b(?:Lote|Bem|Im[óo]vel)\s*(?:n[º°o.]?\s*)?0?(\d{1,2})\s*[)\-–:]/gi)];
  if (cortes.length < 2) return null;
  // Numeração tem de começar em 1 e ser sequencial: "lote 29 da quadra 43" não é enumeração de bens.
  const nums = cortes.map((m) => Number(m[1]));
  if (nums[0] !== 1 || nums.some((n, i) => n !== i + 1)) return null;
  const partes = cortes.map((m, i) => extrairAreaM2(t.slice(m.index, i + 1 < cortes.length ? cortes[i + 1].index : undefined)));
  if (partes.some((a) => !(a > 0))) return null;
  return { soma: Math.round(partes.reduce((x, y) => x + y, 0) * 100) / 100, partes };
}

// Avaliação ATUALIZADA declarada no texto ("Avaliação atualizada R$ 66.650,75 (agosto/2025)").
// Em lote judicial antigo o campo estruturado costuma trazer a avaliação ORIGINAL de um só bem
// (R$ 11.700 de 2005, no mesmo Embu-Guaçu); a atualizada é a que o juízo usa para o lance.
export function avaliacaoAtualizadaDoTexto(texto) {
  const t = decodificarEntidades(String(texto || '')).replace(/\s+/g, ' ');
  const m = t.match(/Avalia[çc][ãa]o\s+(?:total\s+)?atualizada[^R]{0,20}R\$\s*([\d.]+,\d{2})/i);
  const v = m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : 0;
  return v > 0 ? v : 0;
}

// ALQUEIRE (30/09, pendência "decidir regra"). O tamanho muda por região, então a regra é:
// (1) o texto DIZ o tipo ("alqueires paulistas", "alqueire mineiro/goiano/geométrico", "baiano",
// "do norte") → conversão exata; (2) só "alqueire" → pela UF, e SÓ onde a convenção é firme:
// paulista (24.200 m²) em SP/PR/MS; geométrico/goiano (48.400 m²) em MG/GO/DF/TO. (3) Qualquer
// outra UF, ou sem UF → 0: converter ali inventaria área. Medido: 40 lotes ativos sem área citam
// alqueire (PR 29, SP 9, GO 2).
const ALQUEIRE_TIPO = [
  [/^paulistas?\b/i, 24200], [/^(?:mineiros?|goianos?|geom[ée]tricos?)\b/i, 48400],
  [/^baianos?\b/i, 96800], [/^(?:do\s+norte|nortistas?)\b/i, 27225],
];
const ALQUEIRE_UF = { SP: 24200, PR: 24200, MS: 24200, MG: 48400, GO: 48400, DF: 48400, TO: 48400 };
export function areaEmAlqueires(t, uf) {
  const m = String(t || '').match(/(?<![\d.,])(\d{1,4}(?:,\d+)?)(?:\s*\([^)]{1,25}\))?\s*alqueires?\b\s*(?:de\s+terras?\s+)?(.{0,20})/i);
  if (!m) return 0;
  const n = Number(m[1].replace(',', '.'));
  const tipo = ALQUEIRE_TIPO.find(([re]) => re.test(m[2]));
  const fator = tipo ? tipo[1] : ALQUEIRE_UF[String(uf || '').toUpperCase()] || 0;
  const v = n * fator;
  return fator && Number.isFinite(v) && v >= 1000 && v <= 5e9 ? Math.round(v * 100) / 100 : 0;
}

export function extrairAreaM2(texto, { permitirSolta = true, uf = null } = {}) {
  // `permitirSolta=false` (22/08): quando o texto é a PÁGINA INTEIRA (e não uma descrição
  // recortada), o último recurso `NUM m²` casa "área de lazer 300 m²", a metragem de OUTRO lote
  // no rodapé ou um banner — foi assim que o BIASI gravou área inventada, que o trigger de
  // preservação e o merge em memória tornaram permanente e invisível. Os padrões ANCORADOS
  // (construída/privativa/útil/total/terreno) continuam confiáveis mesmo na página toda.
  // Decodifica antes de medir: `100 m&sup2;` e `&aacute;rea constru&iacute;da` são a mesma
  // informação que `100 m²` e `área construída`, e só a segunda forma casa com as regras.
  const t = decodificarEntidades(texto).replace(/\s+/g, ' ');
  if (!t) return 0;
  const UNI = '(?:m²|m2|mts²|metros?\\s+quadrados?)';
  // Até 4 casas decimais (30/09): "49,545 m²" e "124,8930m²" existem em matrícula; com o teto de 2,
  // o número não fechava e o último recurso lia só "545 m²".
  // 01/10: "Terreno de 1.201.00m²" (APICE — milhar E decimal com ponto) gravou 201: nenhuma forma
  // fechava o número inteiro e a solta começava no MEIO dele. A 1ª alternativa lê essa forma, e o
  // lookbehind impede começar depois de dígito ou ponto (o mesmo cuidado de areaEmHectares).
  const NUM = '(?<![\\d.])(\\d{1,3}(?:\\.\\d{3})+\\.\\d{1,2}(?![\\d.])|\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,4})?|\\d+(?:[.,]\\d{1,4})?)';
  const paraNumero = (s) => {
    if (!s) return 0;
    // "1.234,56" (pt-BR) vs "1234.56": só trata o ponto como milhar quando há vírgula decimal.
    // 30/09: "58.255m²" / "13.584m²" (grupo de milhar EXATO, sem vírgula) é milhar — lido como
    // decimal, 18 lotes ativos tinham área mil vezes menor (Gleba 13.584 m² gravada 13,584 m²).
    // "1.5 m²" (1 ou 2 casas depois do ponto) continua decimal.
    if (/^\d{1,3}(?:\.\d{3})+\.\d{1,2}$/.test(s)) return Number(s.replace(/\.(?=\d{3}\.)/g, '')) || 0; // 1.201.00
    const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.'))
      : /^\d{1,3}(?:\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, '')) : Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  const plausivel = (v) => (v >= 8 && v <= 1_000_000 ? v : 0);
  const tentativas = [
    // "área privativa coberta de 41,64m e a área privativa (acessória) de 7,78m, TOTALIZANDO a área
    // privativa de 49,42m" (LEILAOBRASIL, 04/10): o rótulo genérico abaixo casava a PARCELA
    // acessória (7,78) e, sem "²", nada casava. O total declarado vence as parcelas, e só aqui o
    // "m" sozinho é aceito — o "totalizando … área" ancora o bastante para não ser "10m de frente".
    // SÓ "privativa": medido no acervo, "totalizando a área edificada/construída" quase sempre SOMA a
    // área COMUM (SUPERBID 27,71 privativa → 35,47 total; GRUPOLANCE; DJEN) — não é o que baliza o R$/m².
    new RegExp(`totaliz\\w*\\s+(?:a\\s+)?área\\s+(?:real\\s+)?privativa(?:\\s+total)?\\s+(?:de\\s+)?${NUM}\\s*(?:${UNI}|m(?![a-zà-ú\\d]))`, 'i'),
    // "46,57 M2 DE ÁREA PRIVATIVA, 81,42M2 DE ÁREA DO TERRENO" (ficha CAIXA/TORRES3): o número
    // vem ANTES do rótulo. Testar "rótulo → número" primeiro casava "ÁREA PRIVATIVA, 81,42M2" —
    // o número do rótulo SEGUINTE — e a casa saía com a área do terreno (seco de 24/09).
    new RegExp(`${NUM}\\s*${UNI}\\s+de\\s+área\\s+(?:constru[íi]da|privativa|edificada|útil)`, 'i'),
    new RegExp(`área\\s+(?:constru[íi]da|privativa|edificada|útil)[^\\d]{0,20}${NUM}\\s*${UNI}`, 'i'),
    new RegExp(`área\\s+total[^\\d]{0,20}${NUM}\\s*${UNI}`, 'i'),
    // "260 m² de área terreno" / "Área Terreno: 260.00 m²" (BIASI, 29/09): sem o "do". Número
    // ANTES do rótulo primeiro — "área terreno, 144,52 m² de área comum" casaria a área COMUM.
    new RegExp(`${NUM}\\s*${UNI}\\s+de\\s+área\\s+(?:do\\s+)?terreno`, 'i'),
    new RegExp(`área\\s+(?:do\\s+|de\\s+)?terreno[^\\d,;]{0,20}${NUM}\\s*${UNI}`, 'i'),
  ];
  for (const re of tentativas) {
    const v = plausivel(paraNumero((t.match(re) || [])[1]));
    if (v) return v;
  }
  if (!permitirSolta) return 0;
  // Hectare ANTES do m² solto: em rural, "Fazenda c/ 304 ha. e 290 m²" — o m² solto é a sede.
  const ha = areaEmHectares(t);
  if (ha) return ha;
  const alq = areaEmAlqueires(t, uf);
  if (alq) return alq;
  return plausivel(paraNumero((t.match(new RegExp(`${NUM}\\s*${UNI}`, 'i')) || [])[1])); // solta, último recurso
}

// HECTARES (29/09). O extrator só entendia m², e rural se anuncia em hectare ("FAZENDA DE 133,42
// HECTARES", "Chácara 41,61ha"): ~40 lotes rurais ativos ficavam sem área com a área escrita no
// título. Último recurso, depois de todo padrão de m². Três cuidados que o acervo real exigiu:
// (a) o número não pode começar no meio de outro — sem o lookbehind, "10,088463 ha" casava
// "088463 ha" e "2.00.10 HECTARES" casava "00.10"; (b) ha.a.ca ("2.00.10" = 2 ha 00 a 10 ca) é a
// notação de agrimensura e vira 20.010 m²; (c) alqueire fica de fora: vale 24.200 m² em SP,
// 48.400 m² em MG e 27.225 m² no Norte — converter sem saber a região inventa área.
function areaEmHectares(t) {
  const HA = '(?:ha|hectares?)\\b';
  const haACa = t.match(new RegExp(`(?<![\\d.,])(\\d{1,5})\\.(\\d{2})\\.(\\d{2})\\s*${HA}`, 'i'));
  if (haACa) return Number(haACa[1]) * 10000 + Number(haACa[2]) * 100 + Number(haACa[3]);
  const m = t.match(new RegExp(`(?<![\\d.,])(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)\\s*${HA}`, 'i'));
  if (!m) return 0;
  const s = m[1];
  // "Area Com 21769 Ha" (ALBERTOMACEDO): o site comeu o separador — 21,769? 217,69? 21.769?
  // Inteiro de 5+ dígitos sem ponto nem vírgula é ambíguo: não chuta.
  if (/^\d{5,}$/.test(s)) return 0;
  // "1.234 ha" (grupo de milhar exato, sem vírgula) é milhar; "1.5 ha" é decimal.
  const ha = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.'))
    : /^\d{1,3}(?:\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, '')) : Number(s);
  const v = ha * 10000;
  return Number.isFinite(v) && v >= 1000 && v <= 5e9 ? Math.round(v * 100) / 100 : 0;
}

/**
 * ÁREA DA FICHA CAIXA publicada SEM RÓTULO (PESTANA, 24/09).
 * A descrição vem como "Casa - Cidade - UF — Ocupado · Não informado ×4 · TOTAL · PRIVATIVA ·
 * TERRENO · … · Vide Edital · …" — números sem "m²" e sem nome de campo, então `extrairAreaM2`
 * não enxerga nada (ou pega outro número). Leitura POSICIONAL na convenção da CEF: privativa
 * (senão total) para casa/apto; terreno (senão total) para terreno. 0 quando não é esse formato.
 */
export function areaFichaCaixa(descricao, tipo) {
  const d = String(descricao || '');
  if (!/Vide Edital/i.test(d)) return 0; // assinatura do formato — sem ela, posição não significa nada
  const c = d.split(' · ');
  if (c.length < 11 || !/ — /.test(c[0])) return 0;
  const num = (x) => {
    const m = String(x || '').trim().match(/^\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^\d+(?:,\d+)?$/);
    return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : 0;
  };
  const [total, priv, terr] = [num(c[5]), num(c[6]), num(c[7])];
  const ehTerreno = /^terreno/i.test(c[0]) || tipo === 'terreno';
  const v = ehTerreno ? (terr || total) : (priv || total);
  return v >= 10 && v <= 500_000_000 ? v : 0;
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
