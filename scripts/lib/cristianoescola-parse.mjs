/**
 * Parser puro — CRISTIANO ESCOLA LEILÕES (cristianoescolaleiloes.com.br, Caxias do Sul/RS; Cristiano Escola, leiloeiro
 * oficial — TJRS, TRT4, Justiça Federal e vendas diretas de bancos/consórcios). Fila #380. Plataforma BF2 Tecnologia
 * (CodeIgniter, `application/modules/…`), server-rendered, sem anti-bot → fetch direto, grátis. A pista do recon ("Google
 * Sites/blog, ~3 links de lote") era só a home: os destaques dela usam imagens do blogspot, o acervo mora no próprio site.
 * Recon 30/10:
 *
 *   • `/categoria/imoveis`: TODOS os imóveis numa página só (50 em 30/10: 44 judiciais abertos + 6 vendas diretas com
 *     selo "ENCERRADO"). Conferido contra `/lotes/pagina/1…15` (226 lotes de todas as categorias): nenhum imóvel fora
 *     da categoria. Card `<div data-id="<id>" class="… auction-item">` com `<time datetime="2026-11-05 15:20:00">` da
 *     1ª e da 2ª praça e o link `/ver-lote/<id>_<SLUG>`. O card NÃO traz valor ("Lance Sugerido" vazio).
 *   • Página do lote: `<h1 itemprop="name">LOTE ÚNICO - …</h1>` (ou "LOTE 2: …" em leilão de vários lotes), tabela
 *     "Tipo do Imóvel / Situação / Localização do Imóvel" ("Rua Maringá, 89, Bairro Cristal, Vacaria/RS."), a praça
 *     CORRENTE só ("Primeiro Leilão · Finaliza em 05 nov/2026 15:20" — a outra não aparece), "Lance Sugerido R$ …"
 *     (sem lance) ou "Lance Atual R$ …" (com lance), descrição registral, edital `/userfiles/leiloes/*.pdf` e
 *     documentos (AVALIAÇÃO, MATRÍCULA) em `/userfiles/lotes/*.pdf`. Fotos via `/image/resize?…&src=userfiles/lotes/x`
 *     — o arquivo original responde direto em `/userfiles/lotes/x`.
 *   • A data da OUTRA praça só está no card do catálogo: `extrairUrlsDeLote` guarda as duas datas por id e o
 *     `parseDetalhe` as usa (o motor lê o catálogo antes dos lotes, no mesmo processo). Sem o catálogo, sai só a praça
 *     corrente — nunca uma data inventada.
 *   • Valor de avaliação não é publicado na página (está no PDF "AVALIAÇÃO"): na 1ª praça o lance sugerido É a avaliação
 *     (TJRS: 1º leilão pelo valor cheio — o próprio site diz "parcelado no 1° Leilão o VALOR DE AVALIAÇÃO"); na 2ª,
 *     avaliação só se a descrição a citar.
 *   • Venda direta: a página não tem praça nem valor — e o catálogo marca "ENCERRADO". Sem painel de lance = encerrado.
 *   • Erro do próprio site: lotes 5005–5007 têm a "2ª praça" (03/11) ANTES da 1ª (12/11). Data da 2ª que não vem
 *     depois da 1ª é descartada.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

const BASE = 'https://www.cristianoescolaleiloes.com.br';
export const CATALOGO = '/categoria/imoveis';
export const TENANTS = {
  cristianoescola: { fonte: 'CRISTIANOESCOLA', leiloeiro: 'Cristiano Escola Leilões (Cristiano Escola)', base: BASE },
};

export const idDaUrl = (url) => (String(url).match(/\/ver-lote\/(\d+)_/) || [])[1] || null;

const iso = (s) => { const m = String(s || '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/); return m ? `${m[1]}T${m[2]}:${m[3] || '00'}-03:00` : null; };

/** Datas das praças por id, lidas do catálogo (o card tem as duas; a página do lote, só a corrente). */
const PRACAS_DO_CATALOGO = new Map();

/** Cards do catálogo → [{ id, url, d1, d2, encerrado }]. */
export function cardsDoCatalogo(html) {
  const h = String(html || '');
  const out = [];
  const inicios = [...h.matchAll(/<div\s+data-id="(\d+)"[^>]*\bauction-item\b/gi)];
  inicios.forEach((m, i) => {
    const bloco = h.slice(m.index, inicios[i + 1]?.index ?? h.length);
    const link = (bloco.match(/href="((?:https?:\/\/(?:www\.)?cristianoescolaleiloes\.com\.br)?\/ver-lote\/(\d+)_[^"]*)"/i) || []);
    if (!link[1]) return;   // card de LEILÃO (`/leilao-unico/…`), não de lote
    const u = link[1].startsWith('http') ? link[1] : `${BASE}${link[1]}`;
    out.push({
      id: link[2], url: u,
      d1: iso((bloco.match(/square-1[\s\S]*?datetime="([^"]+)"/i) || [])[1]),
      d2: iso((bloco.match(/square-2[\s\S]*?datetime="([^"]+)"/i) || [])[1]),
      encerrado: /badge-closed|>\s*ENCERRADO\s*</i.test(bloco),
    });
  });
  return out;
}

/** Catálogo `/categoria/imoveis` → Map id → url do lote (e guarda as datas das praças para o parseDetalhe). */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const c of cardsDoCatalogo(html)) {
    out.set(c.id, c.url);
    PRACAS_DO_CATALOGO.set(c.id, { d1: c.d1, d2: c.d2, encerrado: c.encerrado });
  }
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

const texto = (html) => decodificarEntidades(String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const MES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
/** "05 nov/2026 15:20" → ISO -03:00. */
function dataPorExtenso(s) {
  const m = String(s || '').match(/(\d{1,2})\s+([a-zç]{3})[a-zç]*\/(\d{4})\s+(\d{1,2}):(\d{2})/i);
  const mes = m && MES[m[2].toLowerCase()];
  return mes ? `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:00-03:00` : null;
}
const FORA = /\b(encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad)/i;
const original = (u) => { const s = String(u || '').match(/[?&]src=([^&"']+)/); return s ? `${BASE}/${decodeURIComponent(s[1]).replace(/^\/+/, '')}` : u; };
// "… - Vacaria/RS" / "… em Toledo-PR" → "Cidade/UF" para o validador de município.
const comBarra = (s) => String(s).replace(/([A-Za-zÀ-ÿ])\s*[–-]\s*([A-Z]{2})\b(?![\wÀ-ÿ])/g, '$1/$2');

export function parseDetalhe(html, url, { agora = new Date(), pracas = PRACAS_DO_CATALOGO } = {}) {
  const h = String(html || '');
  const h1 = texto((h.match(/<h1\s+itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  if (!h1) return null;
  const id = idDaUrl(url);
  const cel = (rot) => texto((h.match(new RegExp(`<th>\\s*${rot}[^<]*<\\/th>\\s*<td>([\\s\\S]*?)<\\/td>`, 'i')) || [])[1]);
  const tipoTabela = cel('Tipo do Im');
  const localizacao = cel('Localiza[çc][ãa]o do Im');
  const situacaoImovel = cel('Situa[çc][ãa]o do Im');
  // Painel de lance: a praça corrente, a data dela e o valor. O comentário HTML do template repete a data — fora.
  const semComent = h.replace(/<!--[\s\S]*?-->/g, ' ');
  const pracaAtual = texto((semComent.match(/class="idSquareAtual">([^<]*)</i) || [])[1]);
  const dataAtual = dataPorExtenso(texto((semComent.match(/Finaliza em\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1]))
    || dataPorExtenso(texto((semComent.match(/(?:Encerra|Inicia) em[\s\S]{0,400}?(\d{1,2}\s+[a-zç]{3}\/\d{4}[\s\S]{0,200}?\d{1,2}:\d{2})/i) || [])[1]));
  // "Lance Sugerido" (sem lance: o mínimo da praça) ou "Lance Atual" (`<strong id="last_offer">`: o maior lance dado).
  const painel = semComent.match(/<h5>\s*(Lance (?:Sugerido|Atual|Inicial|M[íi]nimo))\s*<\/h5>\s*<strong[^>]*>\s*R\$\s*([\d.]+,\d{2})\s*<\/strong>/i);
  const lance = painel ? num(painel[2]) : 0;
  const segunda = /segundo/i.test(pracaAtual);
  const cat = pracas.get(id) || {};
  // Datas: a corrente vem da página; a outra, do card do catálogo. 2ª que não vem depois da 1ª é erro do site (5005).
  let d1 = segunda ? (cat.d1 || null) : (dataAtual || cat.d1 || null);
  let d2 = segunda ? (dataAtual || cat.d2 || null) : (cat.d2 || null);
  if (d1 && d2 && Date.parse(d2) <= Date.parse(d1)) { if (segunda) d1 = null; else d2 = null; }
  if (!d1 && d2) { d1 = d2; d2 = null; }
  const fim = d2 || d1;
  const descHtml = (h.match(/class="div-descricao-text">([\s\S]*?)(?:<div\s+style="text-align:center|<button[^>]*btn-ler-mais|<\/article>)/i) || [])[1] || '';
  const desc = texto(descHtml);
  // Só o rótulo do leiloeiro ("Valor de Avaliação: R$ 667.000,00"); "avaliado em NCr$ 10,00" é a matrícula de 1970 (4983).
  const avalTexto = num((desc.match(/Valor\s+de\s+Avalia[çc][ãa]o[^:R]{0,20}:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const aval = avalTexto || (!segunda && /sugerido/i.test(painel?.[1] || '') ? lance : 0);
  const local = [cidadeDoTexto(comBarra(localizacao)), cidadeDoTexto(comBarra(h1)), cidadeDoTexto(comBarra(desc))].find((c) => c.cidade) || { cidade: null, estado: null };
  // Título: o h1 sem "LOTE ÚNICO - " / "LOTE 2: " / "VENDA DIRETA DE ", em caixa de título. Quando o h1 não diz o
  // tipo ("A TOTALIDADE DOS BENS DESCRITOS NOS LOTES 2 E 3."), o "Tipo do Imóvel" da tabela vai na frente — é ele que
  // faz um conjunto de boxes ("Box/Vaga de Garagem") cair na regra de vaga do acervo.
  const base = titleCase(h1.replace(/^\s*LOTE\s+(?:[ÚU]NICO|\d+)\s*[-–:]\s*/i, '').replace(/^VENDA DIRETA DE\s+/i, '').replace(/[.;\s]+$/, '').toLowerCase())
    .replace(/\/([a-z]{2})\b/gi, (_, uf) => `/${uf.toUpperCase()}`).replace(/\bM²/g, 'm²').replace(/^./, (l) => l.toUpperCase());
  const prefixo = tipoTabela && (/box|vaga|garagem/i.test(tipoTabela) || inferirTipo(base, url) === 'outros') ? `${tipoTabela} - ` : '';
  const titulo = `${prefixo}${base}`;
  const edital = (h.match(/href="([^"]*\/userfiles\/leiloes\/[^"]+\.pdf)"/i) || [])[1] || null;
  const docs = [...h.matchAll(/title-doc-item"[^>]*>\s*<span>([^<]+)<\/span>[\s\S]*?href="([^"]+)"/gi)].map((m) => ({ nome: texto(m[1]), url: m[2] }));
  const matricula = docs.find((d) => /matr[íi]cula/i.test(d.nome))?.url || null;
  const fotos = [...new Set([...h.matchAll(/<a[^>]+href="([^"]+)"[^>]*data-fancybox="gallery"/gi)].map((m) => original(m[1])))];
  const badges = [...semComent.slice(0, semComent.search(/<h1\s+itemprop="name"/i)).matchAll(/<span\s+class="badge[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => texto(m[1]).toUpperCase());
  const venda = badges.some((b) => /VENDA DIRETA/.test(b)) || /^VENDA DIRETA/i.test(h1);
  // Status no painel (fora da descrição, que pode citar "suspenso" no histórico do processo).
  const painelTxt = texto(semComent.slice(semComent.search(/id="product-details"/i), semComent.search(/class="div-descricao-text"/i) > 0 ? semComent.search(/class="div-descricao-text"/i) : undefined));
  const statusFora = FORA.test(painelTxt.replace(/Encerra(?:\/inicia)? em/gi, ' '));
  return {
    titulo: (local.cidade && !titulo.includes(local.cidade) ? `${titulo} - ${local.cidade}/${local.estado}` : titulo).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval, valor_minimo: lance, valor_minimo_2: null,
    modalidade: venda ? 'venda_direta' : badges.some((b) => /EXTRAJUDICIAL/.test(b)) ? 'extrajudicial' : 'judicial',
    area_m2: extrairAreaM2(desc) || extrairAreaM2(h1) || 0,
    descricao: [desc, localizacao && `Localização: ${localizacao}`, situacaoImovel && !/n[ãa]o informado/i.test(situacaoImovel) && `Situação: ${situacaoImovel}.`]
      .filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: d1, data_leilao_2: d2,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || url,
    link_matricula: matricula,
    anexos: [edital && { tipo: 'edital', nome: 'Edital', url: edital },
      ...docs.map((d) => ({ tipo: /matr[íi]cula/i.test(d.nome) ? 'matricula' : 'outro', nome: titleCase(d.nome.toLowerCase()), url: d.url }))].filter(Boolean),
    numero_matricula: numeroMatriculaDoTexto(desc) || null,
    situacao: pracaAtual || (cat.encerrado ? 'ENCERRADO' : null),
    naoImovel: false,
    // Sem painel de lance (venda direta encerrada) ou o card do catálogo dizendo ENCERRADO também fecham o lote.
    encerrado: !!cat.encerrado || statusFora || !pracaAtual || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
