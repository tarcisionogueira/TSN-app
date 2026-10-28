/**
 * Parser puro — Suporte Leilões, front-end "oferta" (10/10). Rafael Leiloeiro (rafaelleiloeiro.com.br,
 * MG/Uberlândia), achado pelo radar de editais do DJEN. Mesma infra dos tenants SUPORTE/JELEILOES
 * (static.suporteleiloes.com.br, api.suporteleiloes.com.br), mas um 3º formato:
 *   • catálogo de imóveis: /busca?tipo=Imoveis (o /buscador?categoria=2 e o /imoveis dão 404);
 *   • lote: /oferta/leilao/imoveis/<cat>/<id>/id-<id>/<slug> — o mesmo padrão de URL do JELEILOES;
 *   • a página traz o lote inteiro em `<script>var lote = {...}; var leilao = {...}</script>`
 *     (valorInicial = 1ª praça, valorInicial2 = 2ª, leilao.praca = praça corrente,
 *     leilao.dataProximoLeilao, leilao.judicial, comissão em leilao.sistemaTaxa).
 * Server-rendered, sem Cloudflare (respondeu 200 à rede do banco): motor `fetch` grátis.
 * O esquema do JSON NÃO é o do LEILAOBRASIL (lá o lote aninha `bem`), por isso parser próprio.
 */
import { inferirTipo, checarQualidade, extrairArea } from './leilaopro-parse.mjs';
import { textoDe, titleCase, montarRowDom } from './dom-parse-util.mjs';
import MUNICIPIOS from '../../api/_municipios.js';
import { normCidade } from './inferir-uf.mjs';

export const TENANTS = {
  rafael: { fonte: 'RAFAELLEILOEIRO', leiloeiro: 'Rafael Leiloeiro', base: 'https://www.rafaelleiloeiro.com.br' },
  // Juntas (levantamento 24/10, leiloeiro_triagem `junta_2410`): o mesmo front "oferta" (/busca?tipo=Imoveis, `var lote`),
  // todos RJ. Seco do motor sobre catálogo + lotes reais (pelo banco): Portella 40 enumerados (2 páginas), Fabiano Ayupp
  // 18, De Paula 9, Leilões JA 4 — todos os lotes lidos prontos. Conferido: portella_3721 (Engenho Novo, Rio de
  // Janeiro/RJ, avaliação R$ 301.187,04, 2º leilão R$ 151.000 em 26/10/2026). Fora: rymerleiloes (52 lotes, mas a
  // página não traz cidade em lugar nenhum legível), sevidanesleiloeira (página do lote responde 500), elydaluzramos e
  // rodrigocostaleiloeiro (catálogo com lotes de praça já vencida marcados "aberto"), camilaleiloes (1 lote).
  portella: { fonte: 'PORTELLA', leiloeiro: 'Portella Leilões', base: 'https://portellaleiloes.com.br' },
  fabianoayupp: { fonte: 'FABIANOAYUPP', leiloeiro: 'Fabiano Ayupp Leiloeiro', base: 'https://fabianoayuppleiloeiro.com.br' },
  depaula: { fonte: 'DEPAULALEILOES', leiloeiro: 'De Paula Leilões', base: 'https://depaulaonline.com.br' },
  leiloesja: { fonte: 'LEILOESJA', leiloeiro: 'Leilões JA', base: 'https://leiloesja.com.br' },
  // 24/10 (pendência 356): sites da triagem575 que a família Suporte antiga (SUPORTE_TENANTS, /buscador) não
  // abria — 404 no /buscador, home Suporte. A home deles linka /busca?tipo=Imoveis e /oferta/leilao/imoveis/…: é ESTE
  // front. Catálogo e lotes lidos pelo banco (pg_net) e passados no motor em seco. Entre parênteses: imóveis no catálogo.
  // A Rapidão Vende tem ainda fazendas/chácaras em /busca?tipo=Fazendas (URL /oferta/leilao/fazendas/…), fora deste
  // catálogo e do padrão de URL — ficam para quando a família ler mais de uma categoria.
  // Casa Forte (casaforteleiloes.com.br, RS) é o mesmo front; os 4 imóveis do catálogo em 24/10 eram todos box de garagem
  // (descartados por regra de negócio no seco). Entrou em 26/10 — bloco no fim da lista.
  aba: { fonte: 'ABALEILOES', leiloeiro: 'ABA Leilões', base: 'https://abaleiloes.com.br' }, // 6, SE
  araujo: { fonte: 'LEILOESARAUJO', leiloeiro: 'Leilões Araújo', base: 'https://leiloesaraujo.com.br' }, // 1, RN/PB
  rapidaovende: { fonte: 'RAPIDAOVENDE', leiloeiro: 'Rapidão Vende', base: 'https://rapidaovende.com.br' }, // 3, TO
  // 26/10 (3ª leva das Juntas, regra do dono: 1 lote já vale): /buscador?categoria=2 dá 404, /busca?tipo=Imoveis abre com
  // `var lote`. Catálogo e lote lidos pelo banco e passados no motor em seco.
  edgarcarvalho: { fonte: 'EDGARCARVALHO', leiloeiro: 'Edgar de Carvalho Jr. Leiloeiro', base: 'https://edgarcarvalholeiloeiro.com.br' }, // 1, RJ
  // 26/10 — LIGADOS (regra do dono: ATIVO em família que já lemos fica ligado mesmo sem imóvel aproveitável hoje).
  // Pelo banco: /busca?tipo=Imoveis HTTP 200 com o <title> "Busca(dor) | <site>" do front "oferta" (o /buscador antigo dá
  // 404). Ricardo Gomes e Rogério Menezes: 0 link /oferta/leilao/imoveis hoje. Casa Forte: 4 de 4 enumerados (box).
  casaforte: { fonte: 'CASAFORTELEIL', leiloeiro: 'Casa Forte Leilões (Jean Miguel Corrêa)', base: 'https://casaforteleiloes.com.br' }, // 4 de 4, box (RS)
  ricardogomes: { fonte: 'RICARDOGOMESLEIL', leiloeiro: 'Ricardo Gomes Leilões', base: 'https://ricardogomesleiloes.com.br' }, // 0 (PR/SC)
  rogeriomenezes: { fonte: 'ROGERIOMENEZES', leiloeiro: 'Rogério Menezes Leiloeiro', base: 'https://rogeriomenezes.com.br' }, // 0 (PI/RJ)
  // JUCEMG/JUCESP (triagem pelo banco `tri2610`): /buscador dá 404 e /busca?tipo=Imoveis abre o front "oferta".
  isac: { fonte: 'ISACLEILOES', leiloeiro: 'Isac Leilões (Isac Vicente da Silva)', base: 'https://www.isacleiloes.com.br' }, // 0 (MG)
  lfr: { fonte: 'LFRLEILOES', leiloeiro: 'Luiz Fernando Leilões (Luiz Fernando Borges Rocha)', base: 'https://www.lfrleiloes.com.br' }, // 2 (MG)
  uni: { fonte: 'UNILEILOES', leiloeiro: 'Unileilões (Fabiana Cusato)', base: 'https://www.unileiloes.com.br' }, // 2 (SP)
  // FORA: simoesleiloes e vjleiloes (MG) — outro front da Suporte ("Aguarde…", bens montados por JS): /busca e /buscador
  // não trazem bem nenhum no HTML; nenhum parser nosso lê esse front.
  // 27/10 — os 4 que estavam FORA entram (pedido do dono: ATIVO em família que já lemos fica conectado, mesmo sem lote
  // aproveitável hoje). Pelo banco (pg_net), /busca?tipo=Imoveis 200 com `var lote` na página do lote. Entre parênteses:
  // imóveis no catálogo em 27/10. O que os deixava de fora agora é tratado no parser, não na lista:
  //  - Ramos (elydaluzramos) e Rodrigo Costa: lote "Aberto para lances" com TODAS as praças vencidas (Ramos 21/10 e
  //    21/11/2025; Rodrigo Costa 14/10/2026) → `pracasVencidas` marca encerrado; o que tiver praça futura entra.
  //  - Rymer: a página não tem o pino de cidade; a cidade sai do título/descrição quando houver, senão o lote entra sem
  //    cidade (UF do leiloeiro), como os do Monteiro no front antigo.
  //  - Camila: o único lote não traz data de praça (`dataProximoLeilao` nulo) — a checagem de qualidade decide.
  rymer: { fonte: 'RYMERLEILOES', leiloeiro: 'Rymer Leilões (Jonas Rymer)', base: 'https://www.rymerleiloes.com.br' }, // 50 (RJ/SP)
  ramos: { fonte: 'RAMOSLEILOES', leiloeiro: 'Ramos Leilões (Ely da Luz Ramos)', base: 'https://www.elydaluzramos.com.br' }, // 4 (SC)
  rodrigocosta: { fonte: 'RODRIGOCOSTA', leiloeiro: 'Rodrigo Costa Leiloeiro', base: 'https://www.rodrigocostaleiloeiro.com.br' }, // 3 (RJ)
  camila: { fonte: 'CAMILALEILOES', leiloeiro: 'Camila Leilões (Camila Nogueira Lima)', base: 'https://www.camilaleiloes.com.br' }, // 1 (RJ)
  // FORA: sevidanesleiloeira.com.br — catálogo com 20 imóveis, mas a página de lote responde HTTP 500 (3 de 3 testadas
  // pelo banco em 27/10, inclusive a URL exata do card): sem página lida não há lote.
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"'#]*\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?(\d+)\/[^"'#\s]+)["'#]/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* href malformado: ignora o link */ }
  }
  return urls;
}
export const idDaUrl = (url) => (String(url).match(/\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?(\d+)/i) || [])[1] || null;

// `var <nome> = {...};` — JSON numa linha só. null = não achou/ilegível (nunca lança).
export function varJson(html, nome) {
  const s = String(html || '');
  const i = s.indexOf(`var ${nome} = {`);
  if (i < 0) return null;
  const ini = s.indexOf('{', i);
  const fim = s.indexOf('};', ini);
  if (fim < 0) return null;
  try { return JSON.parse(s.slice(ini, fim + 1)); } catch { return null; }
}

const valor = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1000 && n <= 500_000_000 ? Math.round(n * 100) / 100 : 0; };
// "22/10/2026 a partir das 14:00" → ISO de Brasília
const dataBr = (t) => {
  const m = String(t || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}):(\d{2}))?/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '12'}:${m[5] || '00'}:00-03:00` : null;
};

// "… HOTEL CARATINGA/MG" → Caratinga; "… CRI TIROS/MG" → Tiros; "… BELO HORIZONTE/MG" → Belo Horizonte.
// Até 4 palavras antes da barra (São João Del Rei), parando em substantivo de imóvel/cartório (não é nome de cidade).
const NAO_CIDADE = /^(HOTEL|PR[ÉE]DIO|CASA|FAZENDA|S[ÍI]TIO|CH[ÁA]CARA|LOTE|TERRENO|APTO|APARTAMENTO|SALA|LOJA|GALP[ÃA]O|[ÁA]REA|CRI|RI|CART[ÓO]RIO|COMARCA|ABC|MATR[ÍI]CULA|N[º°]?|HECTARES?|M²)$/i;
function cidadeAntesDaBarra(t) {
  const m = t.match(/([A-ZÀ-Ú][A-ZÀ-Ú ]{1,60})\/([A-Z]{2})\s*$/);
  if (!m) return null;
  const palavras = m[1].trim().split(/\s+/);
  const nome = [];
  for (let i = palavras.length - 1; i >= 0 && nome.length < 4; i--) {
    if (NAO_CIDADE.test(palavras[i]) || /\d/.test(palavras[i])) break;
    nome.unshift(palavras[i]);
  }
  while (nome.length && /^(DE|DO|DA|DOS|DAS|E)$/i.test(nome[0])) nome.shift();
  return nome.length ? [null, nome.join(' '), m[2]] : null;
}

// "Cidade - UF" do bloco de localização da página (ícone de pino + texto, `<span class="s1">…</svg> Rio de Janeiro - RJ`),
// presente nos sites do mesmo front (Portella, De Paula, Fabiano Ayupp, Leilões JA, Rodrigo Costa — 24/10). É o campo
// estruturado do próprio site; o título nem sempre traz a cidade ("Apartamento no Engenho Novo") e a descrição enganava
// ("…Rio de Janeiro/RJ" virava "Janeiro"). Só vale cidade que existe no IBGE para a UF — senão cai no caminho antigo.
// "…, Urca, Rio de Janeiro/RJ." na descrição (26/10, Edgar de Carvalho): o padrão antigo `de <X>/<UF>` pegava
// "Janeiro". Agora: cada "<palavras>/<UF>" do texto, com o MAIOR sufixo de até 4 palavras que existe no IBGE para a UF.
function cidadeDaDescricao(desc) {
  for (const m of String(desc || '').replace(/<[^>]+>/g, ' ').matchAll(/((?:[A-Za-zÀ-ÿ'.-]+\s+){0,3}[A-Za-zÀ-ÿ'.-]+)\s*[-/]\s*([A-Z]{2})\b/g)) {
    const pal = m[1].trim().split(/\s+/);
    for (let i = 0; i < pal.length; i++) {
      const nome = pal.slice(i).join(' ');
      if (Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${m[2]}|${normCidade(nome)}`)) return [null, nome, m[2]];
    }
  }
  return null;
}
function cidadeDoPino(html) {
  const m = String(html || '').match(/<span class=["']s1["'][^>]*>\s*(?:<svg[\s\S]*?<\/svg>)?\s*([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .-]{1,50}?)\s+-\s+([A-Z]{2})\s*</);
  if (!m) return null;
  const nome = m[1].trim(), uf = m[2];
  return Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(nome)}`) ? [null, nome, uf] : null;
}

// Data da praça (ISO local devolvido por dataBr) ainda por acontecer.
const pracaFutura = (iso) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) && t > Date.now(); };
// Todas as praças conhecidas (próximo leilão, 1º e 2º) passaram há mais de 2 dias. Ramos Leilões (elydaluzramos, 27/10):
// lote.status 1 e "Aberto para lances" com 1º leilão em 21/10/2025 e 2º em 21/11/2025; Rodrigo Costa: próximo leilão
// 14/10/2026. A vitrine não fecha o lote sozinha — sem esta regra ele entraria ativo com praça vencida. Sem data
// nenhuma não decide (fica com o status do site).
const pracasVencidas = (...isos) => {
  const ts = isos.map((d) => Date.parse(String(d || ''))).filter(Number.isFinite);
  return ts.length > 0 && Math.max(...ts) < Date.now() - 2 * 864e5;
};

export function parseDetalhe(html, url) {
  const lote = varJson(html, 'lote');
  const leilao = varJson(html, 'leilao') || {};
  // Sem o JSON não há como saber valor nem praça — "não consegui ler", não lote vazio.
  if (!lote || !lote.id) return null;
  const txt = textoDe(html);

  const v1 = valor(lote.valorInicial), v2 = valor(lote.valorInicial2), v3 = valor(lote.valorInicial3);
  const praca = Number(leilao.praca) || 1;
  // Lance da praça CORRENTE (o "Lance inicial" que o site mostra); avaliação vem 0 neste tenant
  // — sem inventar: a 1ª praça é o valor de avaliação judicial na prática, mas fica nulo aqui.
  const minimo = [v1, v2, v3][praca - 1] || valor(lote.valorAtual) || v2 || v1;
  const avaliacao = valor(lote.valorAvaliacao) || 0;

  // Datas: 1º/2º leilão no HTML ("Primeiro leilão … 30/09/2026", "Segundo leilão … 22/10/2026").
  const d1 = dataBr((txt.match(/Primeiro leil[ãa]o\s+([0-9/]{10}[^A-Z]{0,30})/i) || [])[1]);
  const d2 = dataBr((txt.match(/Segundo leil[ãa]o\s+([0-9/]{10}[^A-Z]{0,30})/i) || [])[1]);
  const prox = dataBr(String(leilao.dataProximoLeilao?.date || '').replace(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}).*/, '$3/$2/$1 $4:$5'));
  const dataLeilao = prox || d2 || d1;

  const titulo = String(lote.titulo || leilao.titulo || '').trim() || null;
  // "… EM JUIZ DE FORA - MG", "PRÉDIO DO ABC HOTEL CARATINGA/MG", "… CRI TIROS/MG" — cidade/UF no fim do título.
  const cu = cidadeDoPino(html) || (titulo || '').match(/\bEM\s+([A-ZÀ-Ú][A-ZÀ-Ú ]+?)\s*[-/]\s*([A-Z]{2})\s*$/i)
    || cidadeAntesDaBarra(titulo || '')
    || cidadeDaDescricao(lote.descricao);
  // Marcação do Word ANTES do corte de 6.000 (28/10, #376): a DEPAULA cola texto do Word com <!--[if gte mso 9]><xml>…
  // — eram 6.000 caracteres de XML e o texto do imóvel ficava do outro lado do corte. Comentário e tag saem aqui.
  const desc = String(lote.descricao || '').replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const reMat = /matr[íi]cula\s*:?\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i;
  const mat = (desc.match(reMat) || String(titulo || '').match(reMat) || [])[1] || null;
  const foto = (String(html).match(/https:\/\/static\.suporteleiloes\.com\.br\/[^"'\s]+\/bens\/\d+\/arquivos\/[^"'\s]+\.(?:jpe?g|png|webp)/i) || [])[0] || null;
  let linkEdital = null;
  for (const m of String(html).matchAll(/<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    if (/edital/i.test(textoDe(m[2]))) { linkEdital = m[1]; break; }
  }
  const comissao = (leilao.sistemaTaxa?.taxas || []).find((t) => /comiss/i.test(t?.nome || ''))?.valor;

  return {
    titulo: titulo ? titleCase(titulo.toLowerCase()).replace(/ - ([a-z]{2})$/i, (_, uf) => ` - ${uf.toUpperCase()}`) : null,
    cidade: cu ? titleCase(cu[1].trim().toLowerCase()) : null,
    estado: cu ? cu[2].toUpperCase() : (/^[a-z]{2}$/i.test(String(leilao.leiloeiroUf || '').trim()) ? String(leilao.leiloeiroUf).trim().toUpperCase() : null), // "Rj" no Fabiano Ayupp
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade: leilao.judicial === false ? 'extrajudicial' : 'judicial',
    area_m2: extrairArea(titulo || '', desc.slice(0, 600)) || 0,
    descricao: desc ? desc.slice(0, 6000) : null,
    data_leilao: dataLeilao,
    data_leilao_2: d2 && dataLeilao && d2.slice(0, 10) > dataLeilao.slice(0, 10) ? d2 : null,
    numero_matricula: mat,
    link_foto: foto,
    link_edital: linkEdital,
    anexos: linkEdital ? [{ tipo: 'edital', nome: 'Edital', url: linkEdital }] : [],
    comissao_pct: comissao != null ? Number(comissao) : null,
    // status do leilão 3 = "Aberto para lances"; lote.status 1 = ativo. lote.status 2 aparece no lote que
    // segue "Aberto para lances" rumo à praça seguinte (Rafael 1014–1018, 27/10: 2º leilão em 27/10) — só
    // vale como aberto com o próximo leilão no FUTURO, para não reabrir lote de praça já passada.
    encerrado: !(Number(lote.status) === 1 || (Number(lote.status) === 2 && pracaFutura(dataLeilao)))
      || pracasVencidas(prox, d1, d2)
      || /arrematad|encerrad|cancelad|suspens/i.test(String(leilao.statusString || '')),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
