/**
 * Parser puro — WR LEILÕES (wrleiloes.com.br; Wesley Silva Ramos, matriz em Boa Vista/RR, filiais Manaus/Macapá/Rio
 * Branco; TRT11, TJRR, DETRAN, SENAD). Pendência 469.
 *
 * O QUE MUDOU (09/11). O site PHP + jQuery server-rendered (`/agenda-de-leiloes` → `/leilao/<id>/<slug>` →
 * `/lote/<id>/<slug>`) virou um app React (Vite) que monta tudo no navegador a partir de um banco próprio — o HTML cru
 * de /leiloes vem sem nenhum leilão. A leitura passa a ser pelo motor `dom` (Chromium renderiza a página), sem tocar na
 * API do site. Os ids viraram uuid: `fonte_id` muda (`wrleiloes_<uuid>`), e os 12 lotes do formato antigo saem pela
 * varredura de sumidos.
 *
 * ESTRUTURA RENDERIZADA (recon 11/11, HTML do Chromium em scripts/testes/fixtures/wrleiloes-*):
 *  - `/leiloes`: cards de leilão (`<h3>` com o nome + link `/leiloes/<uuid>`) em "Em andamento" e "Em breve"; depois de
 *    "Leilões anteriores" vêm os encerrados (fora). DETRAN é só veículo (fora, salvo se o nome citar imóvel).
 *  - `/leiloes/<uuid>`: cabeçalho com "Encerramento DD/MM/AAAA, HH:MM horário de <cidade>", "Local <Cidade> - UF",
 *    "Judicial"/"Extrajudicial" e o EDITAL (PDF em `wrleiloes.s3…/documents/auctions/…`); lista de lotes que cresce
 *    pelo botão "Carregar mais" (12 de 25 na 1ª carga — o motor clica, ver `carregarMais` em fetch-dom.mjs). Card =
 *    `<h3>` com o título + "Lance mínimo" + link `/lotes/<uuid>`. Títulos em caixa alta: "IMÓVEL | ÁREA DE 357,05M² |
 *    RUA 24 DE MAIO Nº 549 | CENTRO", "TERRENO | 816 M² | LOTE 12 | PARINTINS/AM", "HONDA NXR 160 BROS | 2022/2023 |
 *    PLACA …" — o card que não é imóvel sai antes de abrir a página.
 *  - `/lotes/<uuid>`: `<h1>` título, situação ("Aberto para lances"), "Observações" com o texto do bem (avaliação,
 *    matrícula, processo, área), "Mínimo: R$ …", "Encerra em DD/MM/AAAA, HH:MM horário de <cidade>", fotos em
 *    `wrleiloes.s3…/bens/…`, link de volta `/leiloes/<uuid>` (de onde vêm o edital e o local, uma leitura por leilão).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

const BASE = 'https://www.wrleiloes.com.br';
export const TENANTS = {
  wrleiloes: { fonte: 'WRLEILOES', leiloeiro: 'WR Leilões (Wesley Silva Ramos)', base: BASE },
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const idDaUrl = (url) => (String(url).match(new RegExp(`/lotes/(${UUID})`, 'i')) || [])[1] || null;

/** Texto legível do HTML renderizado (quebra de linha nos blocos — o parser procura rótulo + valor por linha). */
export const textoDe = (html) => decodificarEntidades(String(html || '')
  .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<svg\b[\s\S]*?<\/svg>|<!--[\s\S]*?-->/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|section|header|span)>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();

// Cards: cada `<h3>` abre um card; o 1º link do tipo pedido depois dele é o do card.
function cards(html, tipoLink) {
  const out = [];
  for (const pedaco of String(html || '').split(/<h3\b/i).slice(1)) {
    const titulo = textoDe((pedaco.match(/^[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]).replace(/\n/g, ' ');
    const link = pedaco.match(new RegExp(`href="(/${tipoLink}/(${UUID}))"`, 'i'));
    if (titulo && link) out.push({ titulo, caminho: link[1], id: link[2] });
  }
  return out;
}

/** `/leiloes` → Map uuid → url do leilão. Só os abertos (antes de "Leilões anteriores"); DETRAN só se citar imóvel. */
export function extrairUrlsDeEvento(html) {
  const abertos = String(html || '').split(/Leil[õo]es anteriores/i)[0];
  const out = new Map();
  for (const c of cards(abertos, 'leiloes')) {
    if (/detran|tr[âa]nsito|smtran|ve[íi]culos?\b/i.test(c.titulo) && !/im[óo]ve/i.test(c.titulo)) continue;
    out.set(c.id, `${BASE}${c.caminho}`);
  }
  return out;
}

// Fronteira à mão: `\b` do JS não conhece letra acentuada ("ÁREAS DE TERRAS").
const RE_IMOVEL = /(?<![A-Za-zÀ-ÿ])(im[óo]ve(?:l|is)|terrenos?|lotes?\s+de\s+terras?|[áa]reas?\s+de\s+terras?|apartamentos?|apto|casas?|sobrados?|fazendas?|glebas?|ch[áa]caras?|s[íi]tios?|pr[ée]dios?|galp(?:[ãa]o|[õo]es)|salas?\s+comerciai?s?|lojas?|edif[íi]cios?|direitos\s+aquisitivos)(?![A-Za-zÀ-ÿ])/i;
const RE_VEICULO = /\bPLACA\b|\b(?:19|20)\d{2}\s*\/\s*(?:19|20)\d{2}\b|\bRECUPER[ÁA]VEL\b|\bSUCATA\b|\bMOTOCICLETA|\bBARCO\b|\bEMBARCA/i;
export const cardEhImovel = (titulo) => RE_IMOVEL.test(titulo) && !RE_VEICULO.test(titulo);

/** Página do leilão → Map uuid → url do lote. Card de veículo, móvel e equipamento sai aqui. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const c of cards(html, 'lotes')) if (cardEhImovel(c.titulo)) out.set(c.id, `${BASE}${c.caminho}`);
  return out;
}

// "horário de Manaus" → fuso. O site escreve a hora no fuso da cidade do leilão.
const FUSO = { manaus: '-04:00', 'boa vista': '-04:00', 'porto velho': '-04:00', 'rio branco': '-05:00', 'macapá': '-03:00', macapa: '-03:00', 'brasília': '-03:00', brasilia: '-03:00', 'belém': '-03:00', belem: '-03:00' };
/** "30/11/2026, 12:00 horário de Manaus" → ISO com o fuso dito. Sem fuso reconhecido, Brasília. */
export function dataComFuso(txt) {
  const m = String(txt || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:,?\s*(?:às\s*)?(\d{1,2}):(\d{2}))?(?:\s*(?:\n\s*)?hor[áa]rio\s+de\s+([A-Za-zÀ-ÿ ]+?)(?:\s*[·\n]|$))?/);
  if (!m) return null;
  const fuso = FUSO[String(m[6] || '').trim().toLowerCase()] || '-03:00';
  return `${m[3]}-${m[2]}-${m[1]}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}:00${fuso}`;
}

/** Cabeçalho do leilão: nome, encerramento, local, modalidade e edital. */
export function lerLeilao(html) {
  const h = String(html || '');
  const t = textoDe(h);
  const enc = t.match(/Encerramento\n?([^\n]*\d{2}\/\d{2}\/\d{4}[^\n]*(?:\nhor[áa]rio[^\n]*)?)/i);
  const local = (`\n${t}`.match(/\nLocal\s*\n?\s*([A-Za-zÀ-ÿ' ]+?\s*-\s*[A-Z]{2})(?=\s|$)/) || [])[1] || null;
  const edital = (h.match(/href="(https:\/\/[^"]+\/documents\/auctions\/[^"]+\.pdf)"/i) || [])[1] || null;
  return {
    nome: textoDe((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]).replace(/\n/g, ' ') || null,
    encerramento: enc ? dataComFuso(enc[1]) : null,
    local,
    modalidade: /\nExtrajudicial\n/i.test(`\n${t}\n`) ? 'extrajudicial' : /\nJudicial\n/i.test(`\n${t}\n`) ? 'judicial' : null,
    edital,
    encerrado: /\n(Encerrado|Finalizado|Cancelado|Suspenso)\n/i.test(`\n${t.slice(0, 600)}\n`),
  };
}

const UF_EXTENSO = { amazonas: 'AM', roraima: 'RR', acre: 'AC', 'amapá': 'AP', amapa: 'AP', 'pará': 'PA', para: 'PA', 'rondônia': 'RO', rondonia: 'RO', tocantins: 'TO', 'maranhão': 'MA', maranhao: 'MA' };
const RE_UF_EXTENSO = new RegExp(`,?\\s*(?:no\\s+)?Estado\\s+d[oe]\\s+(${Object.keys(UF_EXTENSO).join('|')})(?![A-Za-zÀ-ÿ])`, 'gi');

/** Cidade/UF do texto do bem, nas formas que este leiloeiro usa ("Manaus/AM", "Boa Vista-RR", "Estado do Amazonas"). */
export function cidadeDoBem(texto) {
  const norm = String(texto || '')
    .replace(RE_UF_EXTENSO, (_, e) => `/${UF_EXTENSO[e.toLowerCase()]}`)
    .replace(/\s*[-–]\s*([A-Z]{2})\b/g, '/$1');
  const direto = cidadeDoTexto(norm);
  if (direto.cidade) return direto;
  // Nome sem UF ("Registro de Imóveis … de Manaus.", "nesta cidade de Parintins"): só vale se for município de uma UF
  // citada no texto (ou da região do leiloeiro).
  const ufs = [...new Set([...norm.matchAll(/\/([A-Z]{2})\b/g)].map((m) => m[1]).concat(['AM', 'RR', 'AP', 'AC']))];
  const re = /(?:munic[íi]pio|cidade|comarca|Registro\s+de\s+I\s?m[óo]veis[^.;]{0,60}?|Prefeitura\s+Municipal)\s+d[eoa]s?\s+([A-ZÀ-Ú][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][A-Za-zÀ-ÿ']+){0,3})/g;
  for (const m of norm.matchAll(re)) {
    for (const uf of ufs) { const c = cidadeDoTexto(`${m[1]}/${uf}`); if (c.cidade) return c; }
  }
  return { cidade: null, estado: null };
}

// Uma leitura da página do leilão por execução (cache por fetchFonte: cada rodada do motor tem o seu).
const caches = new WeakMap();
async function leilaoDe(urlLeilao, fetchFonte) {
  if (!urlLeilao || !fetchFonte) return null;
  if (!caches.has(fetchFonte)) caches.set(fetchFonte, new Map());
  const cache = caches.get(fetchFonte);
  if (!cache.has(urlLeilao)) cache.set(urlLeilao, fetchFonte(urlLeilao, { semBD: true }).then((r) => (r?.html ? lerLeilao(r.html) : { erro: r?.via || 'sem resposta' })));
  return cache.get(urlLeilao);
}

const FORA = /encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad|finalizad|sem\s+licitante/i;
const reais = (s) => num(String(s || '').replace(/R\$\s*/, ''));

export async function parseDetalhe(html, url, { fetchFonte = null, agora = new Date() } = {}) {
  const h = String(html || '');
  const titulo = textoDe((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]).replace(/\n/g, ' ').slice(0, 200);
  const t = textoDe(h);
  // Sem título e sem "Encerra em" a página não renderizou (casca do app): "não consegui ler", nunca lote vazio.
  const encTxt = (t.match(/Encerra em\n?([^\n]*\d{2}\/\d{2}\/\d{4}[^\n]*(?:\nhor[áa]rio[^\n]*)?)/i) || [])[1];
  if (!titulo || !encTxt) return null;

  const corpo = ((t.match(/\nObserva[çc][õo]es\n([\s\S]*?)\nHist[óo]rico de lances/i) || [])[1] || '').replace(/\*\*/g, '').trim();
  const descricao = [titulo, corpo].filter(Boolean).join('\n').slice(0, 8000);
  const status = (t.match(/\nLote \d+\n([^\n]+)\n/i) || t.match(/\n(Aberto para lances|Encerrado|Arrematado|Vendido|Suspenso|Cancelado|Em breve)\n/i) || [])[1] || null;
  const minimo = reais((t.match(/M[íi]nimo:\s*(R\$\s*[\d.,]+)/i) || t.match(/Lance m[íi]nimo[^R\n]*(R\$\s*[\d.,]+)/i) || [])[1]);
  const aval = reais((corpo.match(/Avalia[çc][ãa]o(?:\s+total)?:?\s*(R\$\s*[\d.,]+)/i) || corpo.match(/VALOR TOTAL DA AVALIA[ÇC][ÃA]O:?\s*(R\$\s*[\d.,]+)/i) || corpo.match(/avaliad[oa]\s+em[^R]{0,40}(R\$\s*[\d.,]+)/i) || [])[1]);
  // Grava o DIA (local do leilão), como as outras fontes; a hora fica só para decidir "já encerrou". Motivo (11/11): no
  // TRT11 o site diz "Encerra em 30/11/2026, 12:00 horário de Manaus" e o texto do edital diz "no dia 30 de novembro de
  // 2026, às 9h30" — o dia bate, a hora não, e gravar uma hora que diverge do edital é exatamente o erro a evitar.
  const encerraEm = dataComFuso(encTxt);
  const dataLeilao = encerraEm ? encerraEm.slice(0, 10) : null;

  const hrefLeilao = (h.match(new RegExp(`href="(/leiloes/${UUID})"`, 'i')) || [])[1];
  const leilao = await leilaoDe(hrefLeilao ? `${BASE}${hrefLeilao}` : null, fetchFonte);
  if (leilao?.erro) console.log(`   [WRLEILOES] lote ${idDaUrl(url)}: página do leilão não abriu (${leilao.erro}) — segue sem edital`);
  const L = leilao && !leilao.erro ? leilao : null;

  let local = cidadeDoBem(titulo);
  if (!local.cidade) local = cidadeDoBem(corpo);
  if (!local.cidade && L?.local) local = cidadeDoBem(L.local);

  const fotos = [...new Set([...h.matchAll(/src="(https:\/\/wrleiloes\.s3[^"]+\/bens\/[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => m[1]))];
  const processo = (corpo.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/) || [])[0] || null;
  const modalidade = L?.modalidade || (processo || /tribunal|\bvara\b|\btrt\d*\b|judicial/i.test(L?.nome || '') ? 'judicial' : 'extrajudicial');
  const anexos = L?.edital ? [{ tipo: 'edital', nome: 'Edital', url: L.edital }] : [];

  return {
    titulo,
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval || 0, valor_minimo: minimo, valor_minimo_2: null,
    modalidade,
    // A área do TÍTULO vem primeiro ("IMÓVEL | TERRENO 362 M² | …"): no corpo, a 1ª área citada pode ser a construída
    // (Boa Vista, 11/11: o corpo dava 60 m² para o terreno de 362 m²).
    area_m2: extrairAreaM2(titulo) || extrairAreaM2(corpo) || 0,
    descricao: descricao || null,
    data_leilao: dataLeilao, data_leilao_2: null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: L?.edital || null,
    link_matricula: null,
    anexos,
    numero_matricula: numeroMatriculaDoTexto(corpo) || null,
    numero_processo: processo,
    situacao: status,
    naoImovel: !cardEhImovel(titulo),
    encerrado: FORA.test(status || '') || !!L?.encerrado || (encerraEm ? Date.parse(encerraEm) < +agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  link_edital: det.link_edital || url,
  numero_processo: det.numero_processo || null,
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
