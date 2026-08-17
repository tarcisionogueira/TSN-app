/**
 * Núcleo de scraping — EXTRATORES compartilhados pelos coletores.
 * ────────────────────────────────────────────────────────────────────────────
 * Componentes:
 *  1. extrairGenerico()  — extrator heurístico (schema.org, og:tags, padrões)
 *  2. extrairComIA()     — fallback Claude quando a heurística falha
 *  3. checarQualidade()  — valida campos-base (matrícula/foto/valor/descrição)
 *  4. chaveDedup()       — chave de deduplicação entre fontes
 *
 * A camada de PROXY saiu daqui em 12/08 (ver a nota logo abaixo): quem controla
 * acesso pago e custo é `api/_brightdata.js`.
 */

// ── Configuração via variáveis de ambiente ──────────────────────────────────
const CLAUDE_KEY       = process.env.CLAUDE_KEY || '';

// ── 1. CAMADA DE PROXY: NÃO MORA MAIS AQUI ──────────────────────────────────
// Havia aqui um `fetchViaProxy()` com limitador de cota mensal, contador persistido
// em `proxy_uso` e alerta de custo em 80%/100%. Removido em 12/08 por ser uma REDE DE
// PROTEÇÃO QUE NÃO PROTEGIA — e esse é o ponto, não a limpeza:
//
//   · a tabela `proxy_uso` NUNCA existiu no banco. `carregarUso` fazia
//     `const { data } = await supabase.from('proxy_uso')…` sem checar `error`, então lia
//     zero a cada execução; `dentroDoLimite()` respondia "pode gastar" sempre; e o
//     `flushUso` gravava no vazio. Os alertas de 80% e 100% nunca poderiam disparar.
//   · nenhum scraper importava essas funções (os cinco importam só os extratores),
//     então o teto não segurava nada de verdade — mas quem lesse o arquivo concluiria
//     que o gasto de proxy estava limitado e monitorado.
//
// O controle de custo REAL vive em `api/_brightdata.js`: reserva atômica no banco antes
// do fetch (`registrar_uso_brightdata`), sub-cota por propósito, e `ErroBrightData` com
// `semCota` para o chamador distinguir "o orçamento disse não" de "a fonte não tem nada".
// É esse que o ritual de abertura do CLAUDE.md audita toda sessão.

// ── 2. EXTRATOR HEURÍSTICO ──────────────────────────────────────────────────
const _abs = (href, base) => {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return href; }
};

/** Normaliza data para 'YYYY-MM-DD'. Aceita ISO ou 'DD/MM/YYYY'. */
export function normalizarData(s) {
  if (!s) return null;
  const dmy = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const iso = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** Procura a data do leilão priorizando proximidade de palavras-âncora. */
export function extrairData(html) {
  if (!html) return null;
  const texto = html.replace(/<[^>]+>/g, ' ');
  // Prioriza datas próximas de "leilão", "praça", "data" — evita pegar data de cadastro
  const ancora = texto.match(/(?:leil[ãa]o|pra[çc]a|encerr|data\s+do\s+leil)[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i);
  if (ancora) return normalizarData(ancora[1]);
  // Fallback: primeira data futura plausível no texto
  const todas = [...texto.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map(m => m[1]);
  for (const d of todas) {
    const iso = normalizarData(d);
    if (iso && iso >= new Date().toISOString().slice(0, 10)) return iso;
  }
  return null;
}

/** Extrai campos de uma página de detalhe usando padrões comuns. */
export function extrairGenerico(html, urlBase) {
  if (!html) return null;
  const out = { titulo: null, valor_minimo: 0, valor_avaliacao: 0, link_foto: null,
                link_edital: null, link_matricula: null, descricao: null, numero_matricula: null,
                data_leilao: null };

  // schema.org / Open Graph (mais confiável)
  const og = (p) => (html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)["']`, 'i')) || [])[1];
  const jsonLd = (() => {
    const m = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    try { return JSON.parse(m[1].trim()); } catch { return null; }
  })();

  out.titulo = (jsonLd?.name) || og('title') ||
    (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '').trim() || null;

  out.link_foto = _abs((jsonLd?.image?.url || jsonLd?.image || og('image')), urlBase) || null;

  // valores: "R$ 123.456,78"
  const valores = [...html.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map(m => parseFloat(m[1].replace(/\./g, '').replace(',', '.')));
  if (valores.length) {
    out.valor_minimo = Math.min(...valores.filter(v => v > 0)) || 0;
    out.valor_avaliacao = Math.max(...valores) || 0;
  }

  // links de documentos por contexto (texto âncora ou href)
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const txt = (m[2] || '').replace(/<[^>]+>/g, '').toLowerCase();
    const low = href.toLowerCase();
    if (!out.link_edital && (txt.includes('edital') || low.includes('edital'))) out.link_edital = _abs(href, urlBase);
    if (!out.link_matricula && (txt.includes('matr') || low.includes('matricula'))) out.link_matricula = _abs(href, urlBase);
  }

  // número da matrícula no corpo: "Matrícula nº 12.345"
  const mat = html.match(/matr[ií]cula[^\d]{0,20}(\d[\d.\-\/]{2,})/i);
  if (mat) out.numero_matricula = mat[1];

  // data do leilão/praça: "leilão ... 12/07/2026" ou "1ª praça: 12/07/2026"
  out.data_leilao = jsonLd?.startDate ? normalizarData(jsonLd.startDate) : extrairData(html);

  // ─── DESCRIÇÃO: O CORPO ANTES DA META TAG (17/08) ────────────────────────────────────────
  // Até hoje esta linha lia SOMENTE meta tags (og:description → JSON-LD → meta name). Meta
  // description é, por definição, o texto de SEO do SITE — normalmente o mesmo em todas as
  // páginas. Resultado medido no acervo: fora da CEF, a `descricao` do lote é o título e nada
  // mais (SUPERBID 1.492/1.494 · PESTANA 1.029/1.029 · LJUD 981/981 · BIASI 472/472 · ZUK
  // 420/420), e na PECINI vinha literalmente "Pecini Leilões, especialistas em leilões
  // judiciais e extrajudiciais" — a assinatura de marketing, no lugar do imóvel.
  //
  // O custo disso não é estético: a METRAGEM mora no corpo. São 2.227 lotes ativos sem área,
  // 495 sem nem matrícula de onde tirá-la. O dono lê "200 m² construídos" no site do leiloeiro
  // e o nosso relatório imprime "ÁREA NÃO INFORMADA".
  //
  // A correção é CONSERVADORA de propósito, porque esta função é compartilhada por PECINI,
  // GESTAOLEILOES, RJ, SOLEON (CALIL/VEGAS/TORRES3) e SATO: o corpo só substitui a meta tag
  // quando é COMPROVADAMENTE melhor — tem vocabulário de imóvel e é mais informativo. Sem
  // candidato bom, o comportamento antigo vale integralmente. Trocar às cegas arriscaria
  // regredir cinco coletores de uma vez para consertar um.
  const metaDesc = og('description') || jsonLd?.description ||
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || null;
  const corpoDesc = extrairDescricaoDoCorpo(html);
  out.descricao = corpoDesc || metaDesc || null;

  return out;
}

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

/** Extrai URLs de páginas de detalhe a partir de uma página de listagem. */
export function extrairLinksListagem(html, urlBase) {
  if (!html) return [];
  const padrao = /\/(lote|imovel|im[oó]vel|leilao|leil[ãa]o|produto|item|lot)[\/-]?[\w\-]*\d/i;
  const urls = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (!padrao.test(href)) continue;
    const abs = _abs(href, urlBase);
    if (abs) urls.add(abs.split('#')[0]);
  }
  return [...urls];
}

// ── 3. FALLBACK COM IA (Claude) ─────────────────────────────────────────────
/** Usa Claude para extrair campos quando a heurística falha. Custa ~US$ 0,005-0,012/página. */
export async function extrairComIA(html, url) {
  if (!CLAUDE_KEY || !html) return null;
  // Reduz o HTML para baixar custo de tokens (remove script/style/svg)
  const limpo = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 18000);

  const prompt = `Extraia os dados deste imóvel de leilão do HTML abaixo. Responda APENAS com JSON válido, sem texto extra, no formato:
{"titulo":string|null,"valor_minimo":number,"valor_avaliacao":number,"link_foto":string|null,"link_edital":string|null,"link_matricula":string|null,"numero_matricula":string|null,"descricao":string|null,"data_leilao":"YYYY-MM-DD"|null}
A data do leilão é o campo mais importante: procure por "leilão", "praça", "data" e converta para YYYY-MM-DD.
URL base para resolver links relativos: ${url}
HTML:\n${limpo}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const txt = data?.content?.[0]?.text || '';
    const jm = txt.match(/\{[\s\S]*\}/);
    if (!jm) return null;
    const parsed = JSON.parse(jm[0]);
    if (parsed.link_foto)      parsed.link_foto = _abs(parsed.link_foto, url);
    if (parsed.link_edital)    parsed.link_edital = _abs(parsed.link_edital, url);
    if (parsed.link_matricula) parsed.link_matricula = _abs(parsed.link_matricula, url);
    if (parsed.data_leilao)    parsed.data_leilao = normalizarData(parsed.data_leilao);
    return parsed;
  } catch { return null; }
}

// ── 4. CHECAGEM DE QUALIDADE ────────────────────────────────────────────────
/**
 * Valida os campos obrigatórios. Sem DATA o imóvel é DESCARTADO (descartar=true) —
 * sem data não há análise nem agendamento de refresh.
 * Modo estrito (padrão): exige data + valor + foto + edital + matrícula.
 * Retorna { ok, faltando:[], descartar }.
 */
// Só as praças datadas clássicas (1ª/2ª) exigem data. Qualquer outra modalidade
// — venda direta, venda online, licitação, praça única, nome desconhecido —
// aparece sem exigir data (não descartamos por causa do nome da praça).
export function modalidadeExigeData(modalidade) {
  return modalidade === 'primeiro_leilao' || modalidade === 'segundo_leilao';
}

// ─── FRAÇÃO IDEAL NÃO ENTRA NO ACERVO (decisão do dono, 17/08) ──────────────
// "Frações ideais não são interessantes. Pode excluir."
//
// POR QUE VIVE AQUI E NÃO EM CADA COLETOR. A regra JÁ EXISTIA — `scraper-sato.mjs`
// exclui `parte ideal` no seu `RE_EXCLUIR` e o comentário lá a chama de "padrão do
// repo". Só que ela morava dentro de UM scraper: os outros nunca souberam dela, e
// **120 lotes ativos** de parte/fração ideal entraram por eles. Cem estavam
// classificados como imóvel INTEIRO e 57 com área preenchida, então o R$/m² da
// análise rodava sobre o bem todo enquanto o cliente compraria uma fração.
// Regra que vive em comentário de um arquivo não é regra — é intenção. Movida para o
// portão por onde TODOS os coletores passam, e registrada em `regra_negocio`
// (migration fracao_ideal_fora_do_acervo.sql) para a auditoria vigiar.
//
// Comprar 50% indiviso é outro negócio: vira-se condômino de um desconhecido, sem
// ocupar nem vender livremente, dependendo de ação de extinção de condomínio. Um
// relatório que projeta a revenda do bem inteiro sobre isso não está otimista, está
// errado — e o parecer sai dizendo "operação viável, vale avançar".
//
// `nua-propriedade` e `direito creditório` entram pela mesma porta e pela mesma razão
// (não se compra o imóvel, compra-se um direito sobre ele), espelhando o Sato.
export const RE_FRACAO_IDEAL = /\b(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direito[s]?\s+credit[óo]rio|nua[\s-]propriedade)\b/i;

export function ehFracaoIdeal(imovel) {
  return RE_FRACAO_IDEAL.test(`${imovel?.titulo || ''} ${imovel?.descricao || ''}`);
}

export function checarQualidade(imovel, { estrito = true } = {}) {
  const faltando = [];
  // Antes de qualquer checagem de completude: isto sequer deve virar lote. Um registro
  // de fração ideal COMPLETO (com data, valor, foto e matrícula) passaria por todo o
  // resto — a qualidade dos campos nada diz sobre o bem ser vendável.
  if (ehFracaoIdeal(imovel)) {
    return { ok: false, faltando: ['fracao_ideal'], descartar: true, motivo: 'parte/fração ideal — fora do acervo por decisão de negócio' };
  }
  const exigeData = modalidadeExigeData(imovel?.modalidade);
  const semData = exigeData && !imovel?.data_leilao;
  if (semData)                                      faltando.push('data');
  if (!imovel?.valor_minimo || imovel.valor_minimo <= 0) faltando.push('valor');
  if (!imovel?.link_foto)                           faltando.push('foto');
  if (estrito) {
    if (!imovel?.link_edital && !imovel?.link_regras_venda) faltando.push('edital');
    if (!imovel?.link_matricula) faltando.push('matricula');
  } else if (!imovel?.link_edital && !imovel?.link_matricula && !imovel?.link_regras_venda) {
    faltando.push('documentos');
  }
  // Descarta apenas o que inviabiliza o fluxo: sem valor sempre; sem data só
  // quando a modalidade é praça datada (1ª/2ª) e a data não veio.
  const descartar = semData || !imovel?.valor_minimo;
  return { ok: faltando.length === 0, faltando, descartar };
}

// ── 4b. DEDUPLICAÇÃO ────────────────────────────────────────────────────────
const _norm = (s) => (s || '').toString().toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Chave de deduplicação determinística. Prioridade:
 *  1) matrícula (identifica o imóvel de forma única no cartório)
 *  2) CEP + valor mínimo
 *  3) endereço normalizado + cidade
 * Imóveis com a mesma chave são o mesmo bem em fontes diferentes.
 */
export function chaveDedup(imovel) {
  const mat = _norm(imovel?.numero_matricula);
  if (mat && mat.length >= 3) return `mat:${mat}`;
  const cep = _norm(imovel?.cep);
  if (cep && cep.length === 8 && imovel?.valor_minimo) return `cep:${cep}:${Math.round(imovel.valor_minimo)}`;
  const end = _norm(imovel?.endereco), cid = _norm(imovel?.cidade);
  if (end && cid) return `end:${cid}:${end}`.slice(0, 80);
  return null; // sem chave confiável → não deduplica (evita falso positivo)
}

/**
 * Orquestra a extração: heurística → se reprovar na qualidade, tenta IA.
 * Retorna { imovel, fonte_extracao: 'heuristica'|'ia'|'incompleto', qualidade }.
 */
export async function extrairImovel(html, url, { permitirIA = true } = {}) {
  let imovel = extrairGenerico(html, url) || {};
  let q = checarQualidade(imovel);
  let fonte = 'heuristica';

  if (!q.ok && permitirIA && CLAUDE_KEY) {
    const viaIA = await extrairComIA(html, url);
    if (viaIA) {
      // Mescla: heurística como base, IA preenche o que faltou
      imovel = { ...imovel, ...Object.fromEntries(Object.entries(viaIA).filter(([, v]) => v != null && v !== '')) };
      q = checarQualidade(imovel);
      fonte = q.ok ? 'ia' : 'incompleto';
    } else {
      fonte = 'incompleto';
    }
  } else if (!q.ok) {
    fonte = 'incompleto';
  }

  // Sem data (ou sem valor) não entra no fluxo — análise e refresh dependem disso.
  if (q.descartar) fonte = 'descartado';
  return { imovel, fonte_extracao: fonte, qualidade: q, descartar: q.descartar };
}
