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
import { fotoDeHtml, RE_IMG_DESCARTA } from './dom-parse-util.mjs';

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
    (() => { const h = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
              return h ? decodificarEntidades(h.replace(/<[^>]+>/g, '')).trim() : null; })() || null;

  // FALLBACK <img> (10/09, revisão geral de fotos/anexos): schema.org/og:image cobre bem os
  // sites que os publicam — mas quando faltam (medido: RJLEILOES 4% foto, mesmo com 100% doc/
  // descrição — o resto da ficha vem de rótulo no corpo, só a foto dependia só disto), a
  // página fica sem foto mesmo tendo imagem real no HTML. `fotoDeHtml` (dom-parse-util.mjs,
  // mesmo filtro anti-chrome do fix da família `dom`) só entra quando os dois métodos
  // primários não acharam nada — nunca substitui um og:image/JSON-LD que já funcionava.
  // GUARD (17/09): o og:image também pode ser a LOGO do site, não a foto do lote — achado no
  // LEFFA (LeilãoPro), onde a página sem foto própria cai no og:image padrão do template
  // (`.../logo_face.png`), igual pra TODO lote sem foto (11 de 15 lotes ativos com a MESMA
  // url). Como o og:image nunca passava pelo filtro anti-chrome (só `fotoDeHtml` passava),
  // a logo entrava disfarçada de foto real. Mesmo léxico (`RE_IMG_DESCARTA`) agora filtra
  // o og:image/JSON-LD também, e cai pro fallback `fotoDeHtml` quando bate.
  const fotoMeta = _abs((jsonLd?.image?.url || jsonLd?.image || og('image')), urlBase);
  out.link_foto = (fotoMeta && !RE_IMG_DESCARTA.test(fotoMeta)) ? fotoMeta : fotoDeHtml(html, urlBase);

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
  // DECODIFICA ANTES DE CASAR (17/09): esta linha ainda buscava em `html` cru — a mesma
  // entidade não decodificada que já mordeu rótulo de anexo e valor de lance (comentários
  // acima, 17/08) também escondia a matrícula: um site que escreve "Matr&iacute;cula" nunca
  // batia com /matr[ií]cula/, e "Matrícula Imobiliária nº X" saía com numero_matricula nulo
  // mesmo o número estando na página (achado no PECINI, lote 10645: matrícula 4.948 visível
  // na ficha, campo gravado como null).
  const mat = decodificarEntidades(html).match(/matr[ií]cula[^\d]{0,30}(\d[\d.\-\/]{2,})/i);
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

// A CLÁUSULA QUE DESCREVE UM APARTAMENTO NÃO É A FATIA QUE SE VENDE (28/08). Toda matrícula
// de unidade em condomínio traz, por forma cartorial, "e a fração ideal de 1,79088% no
// terreno e demais coisas comuns do condomínio" — o apartamento é vendido INTEIRO e essa
// fração é só como o registro descreve a cota de terreno que acompanha a unidade. Existe em
// todo apartamento do país.
//
// O efeito era PERVERSO: quanto melhor a ficha (enriquecida com o texto da matrícula), maior
// a chance de o lote ser barrado — sumia justamente o acervo mais bem documentado, e em
// silêncio, porque o lote só fica `ativo=false` por trigger, sem erro em lugar nenhum.
// Achado no apartamento de Vila Galvão/Guarulhos cujo relatório o dono gerou em 28/08.
//
// A ÂNCORA É O CONTEXTO DE CONDOMÍNIO, NÃO A PREPOSIÇÃO. A primeira tentativa exigia "no/do
// terreno" e deixava barrados dois apartamentos inteiros que escrevem "fração ideal de
// 0,05015% SOBRE o terreno e áreas comuns" — a mesma cláusula com outra preposição. Isso só
// apareceu porque a regra foi testada contra 25 textos REAIS do acervo, e não contra
// exemplos imaginados. O que de fato separa os dois casos é o entorno: a cláusula cartorial
// de unidade autônoma sempre vem cercada de condomínio / área privativa / área útil / áreas
// comuns; a venda de uma fatia de terreno nu não traz nada disso.
//
// MEDIDO: dos 399 lotes barrados, 367 seguem barrados e 32 foram liberados (25 apartamentos,
// 4 casas, 2 comerciais, 1 imóvel). ZERO lote com termo de fatia — no título ou no texto — escapou.
// A cláusula cartorial escreve o número dos DOIS lados da âncora — as duas ordens
// apareceram ao testar contra 120 textos reais:
//   "fração ideal de 1,79088% no terreno"          (número ANTES)
//   "fração ideal no terreno de 0,31413500%"       (número DEPOIS)
//   "fração ideal de 561/100.000 sobre o terreno"  (fração com barra)
const RE_CLAUSULA_NUM_ANTES = /fra[çc][ãa]o\s+ideal\s+de\s+[0-9][0-9./,]*\s*%?\s*(no|do|na|da|nas|das|em|sobre)\s+(o\s+|a\s+|os\s+|as\s+)?([áa]rea|terreno|solo)/i;
const RE_CLAUSULA_NUM_DEPOIS = /fra[çc][ãa]o\s+ideal\s+(de\s+|do\s+|no\s+|na\s+|em\s+|sobre\s+)?(o\s+|a\s+)?(terreno|solo|[áa]rea\s+comum)\s*(condominial\s*)?(e\s+[^,;.]{0,40})?\s*(de\s+|em\s+)?[0-9]/i;
const RE_CONTEXTO_CONDOMINIO = /(condom[íi]nio|[áa]rea\s+privativa|[áa]rea\s+[úu]til|[áa]rea\s+real|unidade\s+aut[ôo]noma|coisas\s+comuns|[áa]reas\s+comuns|coisas\s+de\s+uso\s+comum)/i;
// Termos que NUNCA são cláusula descritiva. Se qualquer um aparecer, a exceção não vale.
const RE_FATIA_INEQUIVOCA = /\b(parte\s+ideal|fra[çc][õo]es\s+ideais|direito[s]?\s+credit[óo]rio|nua[\s-]propriedade)\b/i;

// ESPELHA `public.fracao_ideal_barrada(text,text)` no banco (migration
// fracao_ideal_clausula_condominio_v3.sql). Mudou a régua aqui, mude lá.
export function ehFracaoIdeal(imovel) {
  const titulo = imovel?.titulo || '';
  const txt = `${titulo} ${imovel?.descricao || ''}`;
  // Menção no TÍTULO nunca é descritiva: é o que está à venda. Barra sempre.
  if (RE_FRACAO_IDEAL.test(titulo)) return true;
  if (!RE_FRACAO_IDEAL.test(txt)) return false;
  // Os dois erros não custam o mesmo: deixar entrar uma fatia gera um relatório que projeta
  // a revenda do bem INTEIRO e conclui "viável"; barrar um apartamento apenas o esconde.
  // Por isso a exceção exige as três condições juntas.
  const clausulaDescritiva = (RE_CLAUSULA_NUM_ANTES.test(txt) || RE_CLAUSULA_NUM_DEPOIS.test(txt))
    && RE_CONTEXTO_CONDOMINIO.test(txt)
    && !RE_FATIA_INEQUIVOCA.test(txt);
  return !clausulaDescritiva;
}

// ACERVO É SÓ IMÓVEL E VEÍCULO (20/09, achado real: "Fresas topo OSG 4c 18mm" — uma fresa de
// usinagem — gravada como `tipo:'terreno'`, fonte LEILAOBRASIL). Leiloeiro judicial multi-bem
// vende o imóvel da empresa falida JUNTO com maquinário, ferramentas, gado, eletrônicos, cotas
// sociais — tudo na mesma vitrine — e um parser sem filtro grava tudo, porque o classificador
// de TIPO sempre devolve alguma coisa (nunca "recusa"). LISTA PERMITIDA, não proibida — mesma
// lição já aprendida em nordeste-parse.mjs (`ehImovel`): "uma lista de palavras PROIBIDAS vira
// caça ao gambá, sempre falta a próxima categoria" (2x seguidas naquele parser). A categoria
// seguinte seria "cadeira odontológica" hoje e "título da dívida agrária" amanhã — impossível
// enumerar tudo que NÃO é. Só passa quem tem sinal de imóvel OU veículo de verdade no texto.
// SEM `\b` de fechamento nos radicais (achado testando contra dado real, ANTES de aplicar no
// banco): "apartament" com `\b` nas duas pontas não bate "Apartamento" nem "Apartamentos" — o
// 'o'/'os' final é caractere de palavra, então não há fronteira ali, e o filtro reprovaria
// exatamente os apartamentos que deveria manter. `\b` só na ABERTURA (ancora o início da
// palavra) deixa o final livre pra singular/plural/variação, sem abrir mão de não casar no
// meio de outra palavra.
// "lote" DE PROPÓSITO fora da lista: em leilão multi-bem toda descrição começa com "Lote N)
// <o que quer que seja>" — é numeração de item de leilão, não terreno. Incluir "lote" batia
// em "Lote 2) 280 Fresas topo OSG 4c 18mm" (achado testando contra dado real, ANTES de aplicar
// no banco) e deixava passar exatamente o item que o filtro existe pra barrar. "terreno" e
// "loteamento" já cobrem o sinal real de lote-de-terreno sem essa ambiguidade.
// "apto"/"aptos" ficou fora numa 1ª rodada por causa do lixo de CSS colado do Word que o
// LEILAOBRASIL carrega em `descricao` ("font-family:\"Aptos\"", a fonte padrão do Office desde
// 2023) — casava em TODA linha da fonte, item de imóvel ou não. Mas validando contra SUPERBID
// (achado real: "APTO 1603, DO BLOCO 02...", "APTO Nº 604...") a abreviação é de uso corrente
// e comum demais pra deixar fora — a colisão é bem mais estreita do que a palavra inteira: só
// acontece quando "Aptos" vem colado a uma aspa (é sempre `"Aptos"` dentro do CSS, nunca solto
// no texto). Negative lookahead resolve sem reabrir a colisão: barra só "apto(s)" seguido de
// aspa, deixa passar todo o resto (incluindo o "apartament\w*" que já cobria a forma completa).
// `galp[õo][ãe]s?` (1ª versão) NUNCA batia "Galpão" singular — achado testando contra BIASI/
// ZUK/WEBLEILOES (galpões reais derrubados, ANTES de ampliar o escopo pra outras fontes): a
// vogal do singular ("galpÃo") e do plural ("galpÕes") trocam de posição, não é só acento —
// character class não cobre isso, precisa de ramo próprio pra cada forma.
// `\bm[²2]\b` (1ª versão) nunca batia "1.575,00M²" colado sem espaço, mesmo depois de tirar a
// fronteira de ABERTURA (achado seguinte, mesmo caso): a fronteira de FECHAMENTO também falhava
// — '²' não é caractere de palavra pro motor de regex, então não há transição palavra↔não-
// palavra entre '²' e o que vem depois (vírgula, traço, fim da string). "m²" não precisa de
// fronteira nenhuma (símbolo já é específico o bastante); só o fallback ASCII "m2" mantém a de
// fechamento, pra não casar dentro de um código tipo "m2050".
//
// 20/09 (2ª rodada, validando contra SUPERBID/LJUD ANTES de ampliar o escopo do invariante):
// mesmos 207 "positivos" nessas 2 fontes, quase todos falso-positivo de estilo de título mais
// terso, não contaminação — 33 sobraram depois dos fixes de galpão/m² acima, revisados um a um:
//   - "lote" (excluído de propósito por causa de "Lote N)" no LEILAOBRASIL) tem uso DIFERENTE
//     aqui: "Lote - Vale dos Cristais", "Lote nº 06 - 450m²" — é terreno de verdade. MAS
//     reintroduzir "lote" solto quebrou "lote de gado" (achado no MESMO teste, antes de
//     aplicar) — "lote de <coisa>" é o uso genérico "partida/porção de X", não terreno,
//     mesma ambiguidade de sempre. Dupla negativa: barra "lote N)" (numeração de item) E
//     "lote de <palavra>" QUANDO a palavra não é terra/terreno — deixa passar "lote de
//     terreno"/"lote de terra" (uso real) sem reabrir a porta pro genérico.
//   - "box" (Box 1611, Box nº 13) é vaga/depósito real nestas fontes — adicionado com contexto
//     (número ou "de garagem") pra não virar sinal solto demais.
//   - "sala" sozinha ("Sala 225", "Sala nº 404") — adicionado com contexto (número/"comercial")
//     pelo mesmo motivo; "salas comerciais" (plural) não batia no "sala comercial" singular.
//   - termos que simplesmente faltavam por não terem aparecido nas 4 fontes já cobertas:
//     "edificação" (stem diferente de "edifício"), "hotel", "barracão", "propriedade rural",
//     "multipropriedade", "imobiliário", "posto de combustível/gasolina", "hectares"/"ha".
// Casos vistos e DEIXADOS de fora de propósito (achado real, não adicionados por serem
// ambíguos, não por esquecimento): "Jazigo" (túmulo — é imóvel juridicamente, mas não serve ao
// propósito de investimento da plataforma) e "Outros - <endereço>" (sem nenhum sinal de tipo,
// só endereço — pode ser imóvel real com categoria não informada pela fonte, mas também pode
// não ser; sem dado suficiente pra decidir automaticamente).
//
// 20/09 (3ª rodada, achado comparando o resultado deste regex contra o espelho SQL rodado sobre
// TODO o acervo ativo de SUPERBID/LJUD, não só os 33 já revisados — 4 divergências, todas
// SUPERBID): "Área Rural - Colonia Murici SJP", "Área de terra Próximo aos Lençóis
// Maranhenses" etc. davam falso positivo (fora_do_acervo=true) quando "Área rural"/"Área de
// terra" era o ÚNICO sinal do título, sem nenhuma outra palavra da lista antes. Causa: `\b` do
// JS considera `\w` só ASCII (`[A-Za-z0-9_]`) — SEMPRE, com ou sem a flag `/u` (não é bug de
// unicode, testado isoladamente) — então a fronteira de ABERTURA do grupo grande nunca bate
// quando o trecho casado começaria bem em cima do "Á" acentuado (início de string/depois de
// espaço): "Á" não é "\w", e o que vem antes (início ou espaço) também não é — sem transição,
// sem fronteira. Mesma classe de bug já visto (fronteira que finge existir e não existe), desta
// vez na abertura em vez do fechamento. Corrigido puxando esta alternativa pra FORA do grupo
// com `\b` compartilhado (mesmo padrão já usado pra m²/ha), com fronteira própria só no
// fechamento — lá "rural"/"terra" terminam em letra ASCII, então funciona.
//
// 22/09 (validando VIP/LEILAOBRASIL/LEILOTECH/ROCHALEILOES antes de ligar o filtro nelas):
// "vaga de garagem" só casava no SINGULAR — um título real da FRAZAO ("Unidade... com 04
// vagas de garagem") dava falso positivo de fora_do_acervo por causa só disso. Mesma classe
// de bug do "sala"/"salas comerciais" (18/09): regex testado contra o singular, nunca contra
// o plural que aparece quando o lote lista MAIS de uma vaga.
const RE_SINAL_IMOVEL =/\b(im[óo]ve(l|is)|imobili[áa]ri[ao]s?|casas?|sobrados?|apartament\w*|apto(?:s(?!["']))?(?![a-z])|flats?|kitnets?|studios?|coberturas?|terrenos?|lotes?(?!\s*\d+\)|\s+de\s+(?!terrenos?\b|terras?\b))|loteament\w*|glebas?|ch[áa]caras?|s[íi]tios?|fazendas?|propriedade\s+rural|multipropriedade|galp(?:[ãa]o|[õo]es)s?|barrac(?:[ãa]o|[õo]es)s?|pr[ée]dios?|edif[íi]cios?|edifica[çc](?:[ãa]o|[õo]es)s?|hot(?:el|[ée]is)|posto\s+de\s+(combust[íi]vel|gasolina)|salas?\s*(?:comerciai?s?|n[ºo°.]|\d)|lojas?|com[eé]rcial|industrial|condom[íi]nios?|matr[íi]culas?|escrit[óo]rios?|boxe?s?\s*(?:de\s+garagem|n[ºo°.]?\s*\d|\d)|vagas?\s+de\s+garagem|metros?\s+quadrados|hectares?)|m²|m2\b|\d\s*ha\b|[áa]rea\s+(rural|de\s+terra)\b/i;
const RE_SINAL_VEICULO = /\b(ve[íi]culos?|autom[óo]ve(l|is)|caminh[õo]es|caminh[ãa]o|caminhonetes?|carretas?|reboques?|semirreboques?|[ôo]nibus|motocicletas?|motonetas?|tratores?|trator|colheitadeiras?|retroescavadeiras?|empilhadeiras?|chassi|chevrolet|volkswagen|\bvw\b|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citro[ëe]n|scania|iveco|volvo|mercedes|kia|mitsubishi|suzuki|yamaha|kawasaki|jeep)\b|\b(19|20)\d{2}\/(19|20)\d{2}\b/i;

export function ehForaDoAcervo(imovel) {
  const txt = `${imovel?.titulo || ''} ${imovel?.descricao || ''}`;
  return !RE_SINAL_IMOVEL.test(txt) && !RE_SINAL_VEICULO.test(txt);
}

export function checarQualidade(imovel, { estrito = true } = {}) {
  const faltando = [];
  // Antes de qualquer checagem de completude: isto sequer deve virar lote. Um registro
  // de fração ideal COMPLETO (com data, valor, foto e matrícula) passaria por todo o
  // resto — a qualidade dos campos nada diz sobre o bem ser vendável.
  if (ehFracaoIdeal(imovel)) {
    return { ok: false, faltando: ['fracao_ideal'], descartar: true, motivo: 'parte/fração ideal — fora do acervo por decisão de negócio' };
  }
  if (ehForaDoAcervo(imovel)) {
    return { ok: false, faltando: ['fora_do_acervo'], descartar: true, motivo: 'nem imóvel nem veículo — acervo é só dessas duas categorias' };
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
