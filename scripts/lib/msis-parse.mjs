/**
 * Parser puro — plataforma MSIS ("desenvolvido por MSIS", msis.com.br; ASP clássico). 21 leiloeiros do RJ (JUCERJA)
 * rodam o mesmo sistema: `/` → `mPrincipal.asp` (celular) e `Principal.asp` (desktop). Medido pelo banco (pg_net) e
 * pelo runner do GitHub em 26/10.
 *
 * ESTRUTURA:
 *   • CATÁLOGO `Principal.asp`: cards de LEILÃO, 12 por página, `onClick="abrirDetalhesLeilao('<zz>')"` com status no
 *     botão (`value="ABERTO PARA LANCES"`, "ENCERRADO"…). GET entrega só a 1ª página dos DESTAQUES; o catálogo
 *     inteiro vem por POST de formulário `acaoDest=N&pag=<n>` (o GET ignora `?pag=`; medido: GET ?pag=2 = página 1).
 *     `acaoDest=S` (o padrão da página) lista só destaques — no MK Lance, 13 páginas contra 15 do `N`.
 *     Paginação: `onClick='pagina(<n>)'` (o maior n é a última página).
 *   • Alguns tenants anunciam leilão de OUTRA plataforma no próprio catálogo (`window.open('https://eblonline…')`,
 *     Davi Mattos): não é MSIS e fica fora — só `abrirDetalhesLeilao` é leilão daqui.
 *   • LEILÃO `Leilao.asp?zz=<zz>` (GET abre): cabeçalho "Leilão ONLINE cód 8432/2026", título do leilão
 *     (`Letra26`), documentos `abrirPDF('<pasta>','<arquivo>.pdf')` → `/Arquivos/<pasta>/<arquivo>`, "Total: N lote(s)
 *     / P página(s)" (página > 1 também por POST `pag`), e cada lote em `<div id="divLote<id>">` com "Lote nº 1 ·
 *     cód do lote 8432/12965", descrição, status ("ABERTO PARA LANCES"), praças "1° Leilão … Data do leilão:
 *     08/12/2026 às 13:00 … Lance inicial 7.000.000,00" (até 3 praças), foto `Arquivos/<pasta>/<pasta>_<lote>_02_….jpg`.
 *   • O lote não tem página própria por GET (o detalhe é POST para Leilao_Lote.asp): tudo sai da página do leilão
 *     (`detalhesDoCatalogo`), e o url_lote é a página do leilão com `&nlo=<id>` (o ASP ignora o parâmetro no GET;
 *     abre o leilão certo).
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, titleCase, montarRowDom, cidadeUFBare, cidadeNestaCidade, semPrefixoCidade, RE_IMG_DESCARTA } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

// Ordem = ordem alfabética do domínio na triagem (leiloeiro_triagem.plataforma = 'ASP_PRINCIPAL').
// `fonte` única (conferida contra imoveis_leilao em 26/10: nenhuma em uso).
const t = (fonte, leiloeiro, dominio) => ({ fonte, leiloeiro, base: `https://www.${dominio}`, catalogo: '/Principal.asp' });
export const TENANTS = {
  adrianayuan: t('ADRIANAYUAN', 'Adriana Yuan Leiloeira', 'adrianayuanleiloeira.com.br'),
  alexandrecosta: t('ALEXANDRECOSTA', 'Alexandre Costa Leilões', 'alexandrecostaleiloes.com.br'),
  analucia: t('ANALUCIA', 'Ana Lúcia Leiloeira', 'analucialeiloeira.com.br'),
  brites: t('BRITES', 'Brites Leiloeiro', 'britesleiloeiro.com.br'),
  bsp: t('BSPLEILOES', 'BSP Leilões', 'bspleiloes.com.br'),
  davimattos: t('DAVIMATTOS', 'Davi Mattos Leiloeiro', 'davimattosleiloeiro.com.br'),
  frederico: t('FREDERICOLEILOES', 'Frederico Leilões', 'fredericoleiloes.com.br'),
  gabriel: t('GABRIELLEILOEIRO', 'Gabriel Leiloeiro', 'gabrielleiloeiro.com.br'),
  gp: t('GPLEILAO', 'GP Leilão', 'gpleilao.com.br'),
  jj: t('JJLEILOEIRO', 'JJ Leiloeiro', 'jjleiloeiro.com.br'),
  silvani: t('SILVANI', 'Leiloeira Silvani', 'leiloeirasilvani.com.br'),
  legentil: t('LEGENTIL', 'Leiloeiro Le Gentil', 'leiloeirolegentil.com.br'),
  marcoscosta: t('MARCOSCOSTA', 'Marcos Costa Leiloeiro', 'marcoscostaleiloeiro.com.br'),
  mklance: t('MKLANCE', 'MK Lance', 'mklance.com.br'),
  moniz: { ...t('MONIZDEARAGAO', 'Moniz de Aragão Leilões', 'monizdearagao.leilao.br') },
  octavio: { ...t('OCTAVIOVIANNA', 'Octavio Vianna Leilões', 'octaviovianna.lel.br') },
  pedrocastro: t('PEDROCASTRO', 'Pedro Castro Leilões', 'pedrocastroleiloes.com.br'),
  ricardocorrea: t('RICARDOCORREA', 'Ricardo Corrêa Leilões', 'ricardocorrealeiloes.com.br'),
  sergiorepresas: t('SERGIOREPRESAS', 'Sérgio Represas Leilões', 'sergiorepresasleiloes.com.br'),
  tostes: t('TOSTES', 'Tostes Leiloeiro', 'tostesleiloeiro.com.br'),
  vianna: t('VIANNALEILOES', 'Vianna Leilões', 'viannaleiloes.com.br'),
};

// Status de card/lote que não está mais à venda: leilão inteiro fica fora da leitura (economiza 1 página por
// leilão velho — o catálogo `N` traz o histórico inteiro).
export const RE_ENCERRADO = /ENCERRAD|ARREMATAD|VENDID|CANCELAD|SUSPENS|RETIRAD|SUSTAD|ADIAD|PREJUDICAD|DESERT|SEM LICITANTE|N[ÃA]O VENDID/i;

/** Último número de página no seletor `pagina(n)` (1 quando não há seletor). */
export function ultimaPagina(html) {
  let max = 1;
  for (const m of String(html || '').matchAll(/pagina\((\d+)\)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Cards do catálogo → [{ zz, status, titulo }] (só leilões MSIS; cards `window.open` de outra plataforma ficam fora). */
export function cardsDoCatalogo(html) {
  const h = String(html || '');
  const out = [];
  const partes = h.split(/<div[^>]+id=["']divAnuncio1_\d+["']/i).slice(1);
  for (const p of partes) {
    const zz = (p.match(/^[^>]*abrirDetalhesLeilao\(\s*'(\d+)'/i) || [])[1];
    if (!zz) continue;
    const status = decodificarEntidades((p.match(/name=["']btnCons["'][^>]*value=["']([^"']+)["']/i) || [])[1] || '').trim();
    const titulo = decodificarEntidades(((p.match(/class=["']Anuncio1_tit["'][^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    out.push({ zz, status, titulo });
  }
  return out;
}

/** Catálogo → leilões ABERTOS (Map zz → url). Leilão encerrado não é lido. */
export function extrairUrlsDeEvento(html, base) {
  const out = new Map();
  for (const c of cardsDoCatalogo(html)) {
    if (c.status && RE_ENCERRADO.test(c.status)) continue;
    out.set(c.zz, `${base}/Leilao.asp?zz=${c.zz}`);
  }
  return out;
}

const zzDoLeilao = (h) => (String(h).match(/var\s+vCod\s*=\s*["']?(\d{10,})/) || String(h).match(/mLeilao\.asp\?zz=(\d{10,})/) || [])[1] || null;
const blocosDeLote = (h) => {
  const s = String(h || '');
  const idx = [...s.matchAll(/<div[^>]+id=["']divLote(\d+)["']/gi)].map((m) => ({ id: m[1], i: m.index }));
  return idx.map((b, k) => ({ id: b.id, html: s.slice(b.i, k + 1 < idx.length ? idx[k + 1].i : s.length) }));
};

/** Leilão → lotes (Map idLote → url do leilão com `nlo`). Página concatenada (várias páginas de lotes) serve igual. */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  const zz = zzDoLeilao(html);
  if (!zz) return out;
  for (const b of blocosDeLote(html)) out.set(b.id, `${base}/Leilao.asp?zz=${zz}&nlo=${b.id}`);
  return out;
}
export const idDaUrl = (url) => (String(url).match(/[?&]nlo=(\d+)/) || [])[1] || null;

/** "Total: 12 lotes / 2 páginas" do leilão (o que o SITE declara) — base da prova de completude. */
export function totalDeclarado(html) {
  const m = String(html || '').match(/Total:\s*(\d+)\s*lotes?\s*\/\s*(\d+)\s*p[áa]gina/i);
  return m ? { lotes: Number(m[1]), paginas: Number(m[2]) } : null;
}

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const dataBr = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function documentosDe(html, base) {
  const out = [];
  for (const m of String(html || '').matchAll(/abrirPDF\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = `${base}/Arquivos/${m[1]}/${m[2]}`;
    if (out.some((a) => a.url === url)) continue;
    const rot = limpo(m[3]) || 'Documento';
    const tipo = /edital/i.test(rot) ? 'edital' : /matr[íi]cula|rgi|registro/i.test(rot) ? 'matricula' : /laudo|avalia/i.test(rot) ? 'laudo' : 'outro';
    out.push({ tipo, nome: rot, url });
  }
  // Edital em HTML (`abrirEdital(<n>)` → Edital.asp?na=<n>): vale como edital quando não há PDF de edital.
  const na = (String(html || '').match(/abrirEdital\((\d+)\)/) || [])[1];
  if (na && !out.some((a) => a.tipo === 'edital')) out.push({ tipo: 'edital', nome: 'Edital', url: `${base}/Edital.asp?na=${na}` });
  return out;
}

function cidadeUfDoTexto(txt) {
  const s = String(txt || '');
  // "…, Copacabana, Rio de Janeiro/RJ." — cidade antes da barra; o bairro fica antes da vírgula.
  const m = [...s.matchAll(/([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .]{1,40}?)\s*\/\s*([A-Z]{2})\b/g)].find((x) => /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(x[2]));
  if (m) {
    const cid = semPrefixoCidade(m[1].replace(/^.*,\s*/, '').replace(/^.*\s-\s/, '').trim());
    if (cid && cid.length >= 3) return { cidade: titleCase(cid), estado: m[2] };
  }
  // "…Ramos, na cidade do Rio de Janeiro." / "no município de Niterói" (MK Lance, 26/10).
  const naCidade = s.match(/\b(?:na\s+cidade|no\s+munic[íi]pio|na\s+comarca)\s+(?:d[eoa]\s+)?([A-ZÀ-Ÿ][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ÿ][A-Za-zÀ-ÿ']+){0,3})(?:\s*[/(-]\s*([A-Z]{2})\b)?/);
  if (naCidade) return { cidade: titleCase(naCidade[1]), estado: naCidade[2] || null };
  const nesta = cidadeNestaCidade(s);
  if (nesta?.cidade) return { cidade: nesta.cidade, estado: nesta.estado || null };
  return cidadeUFBare(s);
}

/** Uma praça: "1° Leilão … Data do leilão: 08/12/2026 às 13:00 … Lance inicial 7.000.000,00". */
function pracasDe(txt) {
  const out = [];
  for (const m of String(txt || '').matchAll(/(\d)\s*[°º]\s*Leil[ãa]o\s+([\s\S]{0,400}?)Lance inicial\s*(?:R\$\s*)?([\d.]+,\d{2})/gi)) {
    const data = dataBr((m[2].match(/Data do leil[ãa]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || m[2].match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1]);
    out.push({ n: Number(m[1]), data, lance: plaus(num(m[3])) });
  }
  return out;
}

/** Um bloco `divLote<id>` + o cabeçalho do leilão → det. `hoje` (ISO) só para os testes. */
export function parseLote(blocoHtml, leilaoHtml, base, { hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const b = String(blocoHtml || '');
  const txt = decodificarEntidades(textoDe(b)).replace(/\s+/g, ' ');
  const descricao = limpo((b.match(/<div[^>]*class=["'][^"']*Letra14 CorCinzaEsc[^"']*["'][^>]*align=["']justify["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]).slice(0, 4000) || null;
  const tituloLeilao = limpo((String(leilaoHtml).match(/<span[^>]*class=["'][^"']*Letra26[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
  const status = limpo((b.match(/<div[^>]*class=["'][^"']*Letra18 CorBranca Negrito[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || [])[1]);
  const pracas = pracasDe(txt);
  const futuras = pracas.filter((p) => p.data && p.data >= hoje);
  const vigentes = futuras.length ? futuras : pracas;
  const lances = vigentes.map((p) => p.lance).filter(Boolean);
  const avaliado = plaus(num((String(descricao || '').match(/AVALIA(?:DO|[ÇC][ÃA]O)[^R$]{0,60}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const primeiro = pracas.find((p) => p.lance)?.lance || 0;
  const minimo = lances.length ? Math.min(...lances) : primeiro;
  // Título: 1ª frase da descrição do lote (o título do leilão costuma ser o processo ou "Itens Diversos").
  const frase = String(descricao || '').split(/(?<=[a-zà-ú0-9)])[.;](?:\s|$)/i)[0] || '';
  const titulo = (frase.length >= 12 ? frase : (descricao || tituloLeilao || '')).slice(0, 180).replace(/[\s,;:–-]+$/, '') || null;
  let { cidade, estado } = cidadeUfDoTexto(descricao);
  if (!cidade) ({ cidade, estado } = cidadeUfDoTexto(tituloLeilao));
  // A plataforma é dos leiloeiros do RJ (JUCERJA); "na cidade do Rio de Janeiro" sem UF é RJ.
  if (cidade && !estado && /^rio de janeiro$/i.test(cidade)) estado = 'RJ';
  const processo = (`${tituloLeilao} ${txt}`.match(/Proc(?:esso|\.)\s*n?\s*[°º.]?\s*:?\s*(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/i) || [])[1] || null;
  const mat = (String(descricao || '').match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;
  const anexos = [...documentosDe(b, base), ...documentosDe(leilaoHtml, base)].filter((a, i, arr) => arr.findIndex((x) => x.url === a.url) === i);
  const foto = (b.match(/<img[^>]+src=["'](Arquivos\/[^"']+\.(?:jpe?g|png|webp))["']/i) || [])[1];
  const judicial = !!processo || /\b(vara|ju[íi]zo|tribunal|trt|tj[a-z]{2}|execu[çc][ãa]o|pgfn|proc\.|dep[óo]sito judicial)/i.test(`${tituloLeilao} ${txt}`);
  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliado || primeiro || minimo, valor_minimo: minimo || avaliado,
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(titulo || '', descricao || ''),
    descricao, data_leilao: vigentes[0]?.data || null, data_leilao_2: vigentes.length > 1 ? vigentes[vigentes.length - 1].data : null,
    numero_matricula: mat, numero_processo: processo, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: foto && !RE_IMG_DESCARTA.test(foto) ? `${base}/${foto}` : null,
    encerrado: !!status && RE_ENCERRADO.test(status),
    status,
  };
}

/** Página do leilão → Map url → det (o lote não tem página própria por GET; tudo sai daqui). */
export function detalhesDoCatalogo(html, base) {
  const out = new Map();
  const zz = zzDoLeilao(html);
  if (!zz) return out;
  for (const bl of blocosDeLote(html)) out.set(`${base}/Leilao.asp?zz=${zz}&nlo=${bl.id}`, parseLote(bl.html, html, base));
  return out;
}

// Nunca chamado na prática (todo lote vem de detalhesDoCatalogo); mantém o contrato do motor.
export function parseDetalhe(html, url) {
  const id = idDaUrl(url);
  const base = String(url).replace(/\/Leilao\.asp.*$/, '');
  const bl = blocosDeLote(html).find((b) => b.id === id);
  return bl ? parseLote(bl.html, html, base) : null;
}

export const montarRow = (url, det, tenant) => ({ ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo), numero_processo: det.numero_processo || null });
export { checarQualidade };
