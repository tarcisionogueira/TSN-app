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
function cidadeDoPino(html) {
  const m = String(html || '').match(/<span class=["']s1["'][^>]*>\s*(?:<svg[\s\S]*?<\/svg>)?\s*([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .-]{1,50}?)\s+-\s+([A-Z]{2})\s*</);
  if (!m) return null;
  const nome = m[1].trim(), uf = m[2];
  return Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(nome)}`) ? [null, nome, uf] : null;
}

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
    || String(lote.descricao || '').match(/\bde\s+([A-ZÀ-Ú][\wÀ-ú ]+?)[-/]([A-Z]{2})\b/);
  const desc = String(lote.descricao || '').replace(/\s*\n\s*/g, ' ').trim();
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
    // status do leilão 3 = "Aberto para lances"; lote.status 1 = ativo. Fora disso não entra.
    encerrado: !(Number(lote.status) === 1) || /arrematad|encerrad|cancelad|suspens/i.test(String(leilao.statusString || '')),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
