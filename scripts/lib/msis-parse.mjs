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
import MUNICIPIOS from '../../api/_municipios.js';
import { normCidade } from './inferir-uf.mjs';

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
    const descr = decodificarEntidades(((p.match(/class=["']Anuncio1_descr["'][^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    out.push({ zz, status, titulo, descr });
  }
  return out;
}

/** Catálogo → leilões ABERTOS (Map zz → url). Leilão encerrado não é lido. */
export function extrairUrlsDeEvento(html, base) {
  const out = new Map();
  for (const c of cardsDoCatalogo(html)) {
    if (c.status && RE_ENCERRADO.test(c.status)) continue;
    // `card=` leva status + descrição do card até o transporte, que os anota na página do leilão (ver parseLote).
    out.set(c.zz, `${base}/Leilao.asp?zz=${c.zz}&card=${encodeURIComponent(`${c.status} | ${c.descr}`.slice(0, 300))}`);
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

// CIDADE SÓ COM PROVA DO IBGE (26/10, dry-run): sem a conferência saíam "Ofício da Cidade do Rio de Janeiro" (MK 2496)
// e "Barra da Tijuca" (bairro, Gabriel 8). Cada candidato — "Cidade/UF" (o MAIOR sufixo que é município), "…, CIDADE,
// UF." / "Cidade| UF", "na cidade de X" — só vale se o par existe; nenhum valeu e o texto diz "Rio de Janeiro" (os 21
// são leiloeiros do RJ: "Centro do Rio de Janeiro", "Barra da Tijuca - Rio de Janeiro") → Rio de Janeiro/RJ.
const UFS_BR = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;
const ehMun = (c, uf) => !!c && !!uf && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`);
const unicaUf = (c) => {
  const n = normCidade(c); let achou = null;
  for (const uf of ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) {
    if (Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${n}`)) { if (achou) return null; achou = uf; }
  }
  return achou;
};
function cidadeUfDoTexto(txt) {
  const s = String(txt || '');
  // "…, Copacabana, Rio de Janeiro/RJ." e "Ofício da Cidade do Rio de Janeiro/RJ": o maior sufixo que é município.
  for (const x of s.matchAll(/([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .]{1,60}?)\s*\/\s*([A-Z]{2})\b/g)) {
    if (!UFS_BR.test(x[2])) continue;
    const pal = x[1].replace(/^.*,\s*/, '').replace(/^.*\s-\s/, '').trim().split(/\s+/);
    for (let k = 0; k < pal.length; k++) { const c = pal.slice(k).join(' '); if (ehMun(c, x[2])) return { cidade: titleCase(c), estado: x[2] }; }
  }
  // "…VERBO DIVINO, BARRA MANSA, RJ." (Sérgio Represas) e "Santa Efigênia, São Paulo| SP" (Vianna).
  for (const x of s.matchAll(/(?:^|[,.;:]\s*)([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' ]{2,40}?)\s*[,|-]\s*([A-Z]{2})\b(?![a-zà-ÿ])/g)) {
    if (ehMun(x[1].trim(), x[2])) return { cidade: titleCase(x[1].trim()), estado: x[2] };
  }
  // "…Ramos, na cidade do Rio de Janeiro." / "no município de Niterói" — sem UF, só nome de UMA UF no IBGE.
  for (const x of s.matchAll(/\b(?:na\s+cidade|no\s+munic[íi]pio)\s+(?:d[eoa]\s+)?([A-ZÀ-Ÿ][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ÿ][A-Za-zÀ-ÿ']+){0,3})/g)) {
    const uf = /^rio de janeiro$/i.test(x[1]) ? 'RJ' : unicaUf(x[1]);
    if (uf && ehMun(x[1], uf)) return { cidade: titleCase(x[1]), estado: uf };
  }
  const nesta = cidadeNestaCidade(s);
  if (nesta?.cidade && ehMun(nesta.cidade, nesta.estado)) return { cidade: nesta.cidade, estado: nesta.estado };
  const bare = cidadeUFBare(s);
  if (ehMun(bare.cidade, bare.estado)) return bare;
  // "Rio de Janeiro" que é ESTADO/foro ("Estado do Rio de Janeiro", "Comarca da Capital do Rio de Janeiro", "Tribunal…")
  // não conta: só a menção solta (endereço, bairro + cidade).
  for (const x of s.matchAll(/\bRio\s+de\s+Janeiro\b/gi)) {
    const antes = s.slice(Math.max(0, x.index - 40), x.index);
    if (!/(estado|tribunal|comarca|vara|ju[íi]zo|jucerja|regi[ãa]o|capital)\s+(?:d[oae]s?\s+)?(?:\S+\s+){0,2}$/i.test(antes)) return { cidade: 'Rio de Janeiro', estado: 'RJ' };
  }
  return { cidade: null, estado: null };
}

/** Uma praça: "1° Leilão … Data do leilão: 08/12/2026 às 13:00 … Lance inicial 7.000.000,00". Variantes medidas em
 * 26/10: sem "Data do leilão" (Alexandre Costa: só "Fechamento: 29/10/2026") e "1° Leilão 22/05/2025 10:00 Lance inicial
 * R$ 420.000,00 … RS 210.000,00" (Gabriel, com o "RS" digitado no lugar de "R$"). 29/10: Pedro Castro escreve "1ª Data …
 * Data de Abertura: 08/09/2026 … Data de Encerramento: 31/12/2026 às 07:00 … Lance inicial 8.000.000,00" — sem casar,
 * os 2 imóveis próprios dele saíam com valor 0 e eram descartados; a data da praça é a de ENCERRAMENTO, não a de abertura. */
function pracasDe(txt) {
  const out = [];
  for (const m of String(txt || '').matchAll(/(\d)\s*[°ºª]\s*(?:Leil[ãa]o|Data)\s+([\s\S]{0,400}?)Lance inicial\s*(?:R\s*[$S]\s*)?([\d.]+,\d{2})/gi)) {
    const data = dataBr((m[2].match(/Data do leil[ãa]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || m[2].match(/(?:Fechamento|Data de Encerramento)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || m[2].match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1]);
    out.push({ n: Number(m[1]), data, lance: plaus(num(m[3])) });
  }
  return out;
}

/** Um bloco `divLote<id>` + o cabeçalho do leilão → det. `hoje` (ISO) só para os testes. */
export function parseLote(blocoHtml, leilaoHtml, base, { hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const b = String(blocoHtml || '');
  const txt = decodificarEntidades(textoDe(b)).replace(/\s+/g, ' ');
  // Cor do texto varia por tenant (CorCinzaEsc · CorBranca no Sérgio Represas).
  const descricao = limpo((b.match(/<div[^>]*class=["'][^"']*Letra14 Cor\w+[^"']*["'][^>]*align=["']justify["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]).slice(0, 4000) || null;
  // Status/descrição do CARD do catálogo, anotados pelo transporte (fetch-msis) no topo da página do leilão: o Gabriel
  // marca "VENDA DIRETA" só no card, e a Vianna escreve "DESCONSIDERAR AS DATAS NESTE SITE" só na descrição do card.
  const card = decodificarEntidades((String(leilaoHtml).match(/<!-- msis-card: ([\s\S]*?) -->/) || [])[1] || '');
  const tituloLeilao = limpo((String(leilaoHtml).match(/<span[^>]*class=["'][^"']*Letra26[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
  const status = limpo((b.match(/<div[^>]*class=["'][^"']*Letra18 CorBranca Negrito[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || [])[1]);
  const pracas = pracasDe(txt);
  const futuras = pracas.filter((p) => p.data && p.data >= hoje);
  const vigentes = futuras.length ? futuras : pracas;
  const lances = vigentes.map((p) => p.lance).filter(Boolean);
  const avaliado = plaus(num((String(descricao || '').match(/AVALIA(?:DO|[ÇC][ÃA]O)[^R$]{0,60}R\$\s*([\d.]+,\d{2})/i)
    || String(descricao || '').match(/Avalio\s+o\s+referido[^0-9]{0,40}([\d.]+,\d{2})/i) || [])[1]));
  // "Avaliação: R$ 30.400.000,00 | Valor Mínimo: R$ 15.200.000,00" (lotes da Comprei/PGFN na Vianna).
  const minDeclarado = plaus(num((String(descricao || '').match(/Valor\s+M[íi]nimo\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  // VENDA DIRETA: o leilão/lote diz que a venda é por proposta (Gabriel "VENDA DIRETA", Vianna "propostas de compra…
  // na PLATAFORMA DA COMPREI. Desconsiderar as datas deste site") — as datas do site são de enfeite e não valem.
  const vendaDireta = /VENDA DIRETA/i.test(`${status} ${card}`) || /venda\s+direta|propostas?\s+de\s+compra\s+s[ãa]o\s+realizadas|desconsiderar\s+as\s+datas/i.test(`${descricao || ''} ${card}`);
  const primeiro = pracas.find((p) => p.lance)?.lance || 0;
  const minimo = minDeclarado || (lances.length ? Math.min(...lances) : primeiro);
  // Título: a 1ª frase da descrição que FALA DO BEM (a 1ª costuma ser aviso — "As propostas de compra são realizadas
  // diretamente…", "LAUDO DE AVALIAÇÃO:"); o título do leilão é o processo ou "Itens Diversos".
  const frases = String(descricao || '').replace(/^LAUDO DE AVALIA[ÇC][ÃA]O\s*:\s*/i, '').split(/(?<=[a-zà-ú0-9)]{3})[.;](?:\s|$)|_{5,}/i).map((f) => f.trim()).filter((f) => f.length >= 12);
  const RE_BEM = /\b(apartamento|apto|casa|sobrado|terreno|lote|gleba|sala|loja|pr[ée]dio|galp[ãa]o|im[óo]ve(?:l|is)|fazenda|s[íi]tio|ch[áa]cara|[áa]rea|cinema|edif[íi]cio|unidade|cobertura|box|vaga|kitnet|resid[êe]ncia|constru[çc][ãa]o)/i;
  const frase = frases.find((f) => RE_BEM.test(f) && !/proposta|desconsiderar|aten[çc][ãa]o/i.test(f.slice(0, 40))) || frases[0] || '';
  const titulo = (frase || descricao || tituloLeilao || '').slice(0, 180).replace(/[\s,;:–_-]+$/, '') || null;
  let { cidade, estado } = cidadeUfDoTexto(descricao);
  if (!cidade) ({ cidade, estado } = cidadeUfDoTexto(tituloLeilao));
  const processo = (`${tituloLeilao} ${txt}`.match(/Proc(?:esso|\.)\s*n?\s*[°º.]?\s*:?\s*(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/i) || [])[1] || null;
  const mat = (String(descricao || '').match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;
  const anexos = [...documentosDe(b, base), ...documentosDe(leilaoHtml, base)].filter((a, i, arr) => arr.findIndex((x) => x.url === a.url) === i);
  const foto = (b.match(/<img[^>]+src=["'](Arquivos\/[^"']+\.(?:jpe?g|png|webp))["']/i) || [])[1];
  const judicial = !!processo || /\b(vara|ju[íi]zo|tribunal|trt|tj[a-z]{2}|execu[çc][ãa]o|pgfn|proc\.|dep[óo]sito judicial)/i.test(`${tituloLeilao} ${txt}`);
  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliado || primeiro || minimo, valor_minimo: minimo || avaliado,
    modalidade: vendaDireta ? 'venda_direta' : judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(titulo || '', descricao || ''),
    descricao, data_leilao: vendaDireta ? null : vigentes[0]?.data || null, data_leilao_2: !vendaDireta && vigentes.length > 1 ? vigentes[vigentes.length - 1].data : null,
    numero_matricula: mat, numero_processo: processo, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: foto && !RE_IMG_DESCARTA.test(foto) ? `${base}/${foto}` : null,
    encerrado: !!status && RE_ENCERRADO.test(status),
    status,
    // Lote cuja venda acontece no COMPREI (PGFN) — auditório/proposta em comprei.pgfn.gov.br/anuncio/detalhe/<id>: já
    // entra pela fonte COMPREI; aqui seria o mesmo imóvel duas vezes (mesma regra do Degrau/UP Leilão 89).
    naoImovel: /comprei\.pgfn\.gov\.br\/anuncio\/detalhe\/\d+/i.test(b) || undefined,
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
