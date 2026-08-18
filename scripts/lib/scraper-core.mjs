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

// Descrição/metragem do imóvel: definidas em `api/_texto-imovel.js` porque o enriquecedor
// sob demanda (api/) também as usa. A direção scripts → api é a convenção do repo.
import { extrairDescricaoDoCorpo, extrairAreaM2, decodificarEntidades } from '../../api/_texto-imovel.js';
import { nomeiaUmDocumento } from '../../api/_doc-scan.js';

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
  // DECODIFICA ANTES DE PROCURAR A ÂNCORA (18/08). Sem isto, um site que publica
  // `Leil&atilde;o` ou `pra&ccedil;a` — forma comum em página salva em ISO — não casa com
  // NENHUMA das palavras-âncora, e a função cai no fallback "primeira data futura do texto",
  // que num portal de leilão costuma ser data de cadastro ou de outro lote. O resultado é uma
  // data ERRADA gravada com cara de certa, sem erro em lugar nenhum. É a mesma forma que
  // escondeu o lance da PECINI (`1&ordm; Leil&atilde;o`), aqui na biblioteca que serve
  // RJ, GESTAO, PECINI, SOLEON, SATO e o coletor canônico.
  const texto = decodificarEntidades(html.replace(/<[^>]+>/g, ' '));
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
    const href = m[1];
    const txt = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, '')).toLowerCase();
    const low = href.toLowerCase();
    const abs = _abs(href, urlBase);
    // O LINK PRECISA NOMEAR UM DOCUMENTO (18/08). Uma âncora rotulada "Matrícula" cujo href é
    // a ROTA que serve os arquivos (`/preview/`, sem o nome do arquivo) virava `link_matricula`
    // NOT NULL: a ficha anunciava "matrícula disponível" e entregava uma pasta vazia. Consertado
    // ontem em `api/_doc-scan.js` e no scraper da PECINI; esta cópia na biblioteca compartilhada
    // tinha ficado para trás, e é a que atende RJ, GESTAO, SOLEON, SATO e o coletor canônico.
    if (!abs || !nomeiaUmDocumento(abs)) continue;
    if (!out.link_edital && (txt.includes('edital') || low.includes('edital'))) out.link_edital = abs;
    if (!out.link_matricula && (txt.includes('matr') || low.includes('matricula'))) out.link_matricula = abs;
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

// Reexporta para os coletores que já importam daqui — a definição é uma só.
export { extrairDescricaoDoCorpo, extrairAreaM2 };

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
