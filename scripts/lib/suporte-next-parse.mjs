/**
 * Parsers puros — os fronts Next.js NOVOS da Suporte Leilões que nenhum parser nosso lia (26/10, pedido do dono:
 * "ligar mesmo com catálogo vazio, para pegar os lotes futuros"). Três sites, três fronts DIFERENTES — o que
 * têm em comum é o banco da Suporte por trás (`static.suporteleiloes.com.br/<cliente>/bens/<id>/arquivos/…`,
 * `realtime-v2.suporteleiloes.com`) e o servidor renderizar a página inteira (SSR): o HTML que o fetch recebe já
 * traz título, valores, praças, especificações e documentos. NÃO é o front de scraper-suportev2.mjs (Marco Antônio
 * & cia: `/lotes/<id>` com `initialLote` no payload RSC) nem o "oferta" (`/busca?tipo=Imoveis`, `var lote`).
 *
 * Medido pelo banco (pg_net) em 26/10:
 *  - LANCEVIP (lancevip.com.br — Lance VIP, RO/MT/PR/SC; Evanilde, Bruno, Ana Carolina e Andressa Rosa): catálogo
 *    `/lotes?subcategoria=15,16,17,18,20` (imóveis urbanos 15–18 + rurais 20, os dois atalhos da home com "18" e "8
 *    lotes disponíveis"), 12 por página em `&page=N`, contador "Exibindo 1–12 de 26". Lote `/leilao/<leilão>/lote/<n>`
 *    (o número do lote é POR LEILÃO: o id é `<leilão>-<n>`). Praças em `li.lv-praca` (data + valor), specs em
 *    `dl.lv-specs` (Categoria, Matrícula, Cidade, UF, Modalidade, Processo), docs em `ul.lv-lote-docs`.
 *  - VIX (vixleiloes.com.br — Gabriel Fardin Pereira, ES): a agenda `/leiloes` lista EVENTOS (status no card:
 *    "Aberto para lances", "Em breve", "Encerrado"…); o lote mora no evento (`/leiloes/<id>-<slug>`, 24 por página em
 *    `?page=N`, contador "N lotes encontrados") e o card do lote já diz o tipo ("Caminhão · VILA VELHA — ES",
 *    "Imóveis · Serra — ES"). O filtro `?categoria=Imóveis` da agenda é IGNORADO pelo site (devolve os 373 eventos) —
 *    por isso o tipo é lido no card do lote. Lote `/lote/<id>-<slug>`: JSON-LD Product (preço, fotos, endereço) +
 *    `dl` de especificações (Categoria, Tipo, Cidade/UF "Serra — ES", CEP, Valor de avaliação).
 *  - PORTAL (portaldosleiloes.com.br — Isaldo Sobral e Silva / Douglas Nascimento, AL): catálogo
 *    `/lotes?categoria=Imóveis` (o filtro do PRÓPRIO site; em 26/10 "Nenhum lote encontrado" — as categorias com lote
 *    são Materiais/Equipamentos e Veículos de usinas), `?page=N`. Lote `/lote/<slug>`: props RSC do painel
 *    (`loteId`, `valorInicial`, `dataEncerra`, `statusLabel`, `vendaDireta`) + specs `lei-lote-spec__k/__v`.
 */
import MUNICIPIOS from '../../api/_municipios.js';
import { decodificarEntidades } from '../../api/_texto-imovel.js';
import { inferirTipo, extrairArea } from './leilaopro-parse.mjs';
import { checarQualidade as checarQualidadeBase } from './scraper-core.mjs';
import { plaus, titleCase, montarRowDom, UFS } from './dom-parse-util.mjs';
import { normCidade } from './inferir-uf.mjs';

// ── utilidades comuns ────────────────────────────────────────────────────────────────────────────
const semTags = (h) => decodificarEntidades(String(h || '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
const umaLinha = (h) => semTags(h).replace(/\s+/g, ' ').trim();
// Corpo sem <script>/<style>/<svg>: o payload RSC repete o HTML inteiro como texto, e casar regex nele daria o
// mesmo dado duas vezes (ou o dado de outro componente).
const corpo = (html) => String(html || '').replace(/<(script|style|svg|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
export const brl = (s) => {
  const m = String(s || '').match(/R\$\s*([\d.]+(?:,\d{1,2})?)/);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) || 0 : 0;
};
// "04/12/2026 10:00" | "04/11/2026, 10:00" | "31/12/2026" → ISO no horário de Brasília (o site diz "Brasília").
export function dataBR(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:[,\s·àsa-z]*?(\d{1,2})[:h](\d{2}))?/i);
  if (!m) return null;
  const [, d, mo, a, h = '00', mi = '00'] = m;
  const iso = `${a}-${mo}-${d}T${h.padStart(2, '0')}:${mi}:00-03:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}
// Pares rótulo→valor de <dt>/<dd> (LanceVIP e VIX escrevem as especificações assim). O 1º rótulo vence.
export function paresDl(html) {
  const out = new Map();
  for (const m of corpo(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const k = umaLinha(m[1]), v = umaLinha(m[2]);
    if (k && !out.has(k)) out.set(k, v);
  }
  return out;
}
export function jsonLd(html, tipo) {
  for (const m of String(html || '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const o = JSON.parse(m[1]); if (!tipo || o?.['@type'] === tipo) return o; } catch { /* bloco ilegível: tenta o próximo */ }
  }
  return null;
}
const existe = (uf, nome) => !!uf && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(nome)}`);
// Cidade só se o IBGE a conhece para a UF (o campo é digitado à mão: "VILA VELHA", "São Miguel do Guaporé").
export function cidadeIbge(nome, uf) {
  const c = String(nome || '').replace(/\s*[/–—-]\s*[A-Z]{2}\s*$/, '').trim();
  return c && existe(uf, c) ? titleCase(c) : null;
}
// "…Colombo/PR" / "…Serra — ES" / "Sarandi/PR —" no texto: o MAIOR sufixo que existe no IBGE.
export function cidadeDoTexto(txt, ufPreferida = null) {
  for (const m of String(txt || '').matchAll(/([A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){0,5})\s*(?:\/|\s[–—-]\s|,\s*)([A-Z]{2})(?![A-Za-z])/g)) {
    if (!UFS.has(m[2]) || (ufPreferida && m[2] !== ufPreferida)) continue;
    const p = m[1].trim().split(/\s+/);
    for (let i = 0; i < p.length; i++) {
      const n = p.slice(i).join(' ');
      if (existe(m[2], n)) return { cidade: titleCase(n), estado: m[2] };
    }
  }
  return null;
}
function anexo(nome, url) {
  const n = String(nome || '').trim() || 'Documento';
  const tipo = /matr[íi]cula|inteiro\s+teor|transcri[çc][ãa]o/i.test(n) ? 'matricula' : /edital/i.test(n) ? 'edital'
    : /laudo|avalia/i.test(n) ? 'laudo' : 'outro';
  return { tipo, nome: n.slice(0, 120), url };
}
const unicos = (a) => [...new Set(a.filter(Boolean))];
const MODALIDADE = (s) => /venda\s*direta/i.test(s || '') ? 'venda_direta' : /extra\s*judicial/i.test(s || '') ? 'extrajudicial'
  : /judicial/i.test(s || '') ? 'judicial' : null;
export const RE_FECHADO = /vendid|arrematad|encerrad|cancelad|suspens|retirad|sem\s+licitante|prejudicad|desert|finalizad|conclu[íi]d|realizad|rascunho/i;
// Tipo que a PRÓPRIA fonte declara (categoria/subcategoria do lote) → o nosso. Nada que não seja imóvel aqui.
const TIPO_POR_CATEGORIA = [[/apart|cobertura|flat|kitnet/i, 'apartamento'], [/casa|sobrado|resid/i, 'casa'],
  [/rural|fazenda|s[íi]tio|ch[áa]cara|gleba/i, 'rural'], [/terreno|lote/i, 'terreno'],
  [/comercial|loja|sala|galp|pr[ée]dio|industrial|ponto|hotel|pousada|escrit/i, 'comercial']];
const tipoDaCategoria = (c) => (TIPO_POR_CATEGORIA.find(([re]) => re.test(String(c || ''))) || [])[1] || null;
export const RE_CAT_IMOVEL = /im[óo]ve|apart|casa|sobrado|terreno|lote\s+urbano|rural|fazenda|s[íi]tio|ch[áa]cara|gleba|galp[ãa]o|pr[ée]dio|sala\s+comercial|comercia|loja|kitnet|cobertura|flat|[áa]rea/i;
export const RE_CAT_VEICULO = /ve[íi]cul|carro|autom[óo]v|moto|caminh|[ôo]nibus|utilit|camionete|pick-?up|van\b|reboque|semirreboque|cavalo\s+mec/i;

// Linha comum aos três fronts (montarRowDom + o que ele não sabe).
function linha(url, det, tenant) {
  const base = montarRowDom(url, det, tenant, det.id, inferirTipo);
  const row = {
    ...base,
    tipo: det.tipo || base.tipo,
    link_edital: det.link_edital || url,
    endereco: det.endereco || null, bairro: det.bairro || null, numero_processo: det.numero_processo || null,
    valor_minimo_2: det.valor_minimo_2 || null,
    ...(det.cep ? { cep: det.cep } : {}),
    ...(det.fotos?.length ? { fotos: det.fotos } : {}),
  };
  // A categoria dita pela FONTE (veículo, máquina, "Diversos") decide o descarte em checarQualidade — fora das
  // chaves enumeráveis para não entrar no upsert (mesmo contrato de suportev2-parse).
  Object.defineProperty(row, '_tipoBem', { value: det.eh_imovel === false ? (det.categoria || 'não informado') : null, enumerable: false });
  return row;
}
export function checarQualidade(row, opts) {
  if (row?._tipoBem) return { ok: false, descartar: true, faltando: ['fora_do_acervo'], motivo: `a fonte classifica o bem como "${row._tipoBem}" (não imóvel)` };
  return checarQualidadeBase(row, opts);
}
const ehImovelPelaCategoria = (cat) => (cat ? RE_CAT_IMOVEL.test(cat) && !RE_CAT_VEICULO.test(cat) : null);

// ══ LANCEVIP ═════════════════════════════════════════════════════════════════════════════════════
export const LANCEVIP = (() => {
  const TENANTS = { lancevip: { fonte: 'LANCEVIP', leiloeiro: 'Lance VIP Leilões', base: 'https://www.lancevip.com.br' } };
  // Só o CARD do catálogo (`lv-lote-card`): a página do lote tem "Veja também" com outros lotes, e o catálogo de um
  // filtro não pode puxar lote de outro. Duas formas de link no MESMO catálogo: `/leilao/<leilão>/lote/<n>` (o número
  // do lote é por leilão → id `<leilão>-<n>`) e `/lote/<referência>` (lote avulso, "Referência 35683" na página —
  // a moto de Alta Floresta do Oeste no catálogo de veículos de 26/10) → id `ref<referência>`.
  const RE_CARD = /<a\s+href="(\/(?:leilao\/(\d+)\/lote\/(\d+)|lote\/(\d+)))"\s+class="lv-lote-card\b/g;
  function extrairUrlsDeLote(html, base) {
    const out = new Map();
    for (const m of String(html || '').matchAll(RE_CARD)) out.set(m[4] ? `ref${m[4]}` : `${m[2]}-${m[3]}`, new URL(m[1], base).href);
    return out;
  }
  const idDaUrl = (url) => {
    const m = String(url).match(/\/leilao\/(\d+)\/lote\/(\d+)/);
    if (m) return `${m[1]}-${m[2]}`;
    const r = String(url).match(/\/lote\/(\d+)(?:[/?#]|$)/);
    return r ? `ref${r[1]}` : null;
  };
  // "Exibindo 1–12 de 26 lotes" — o total que o PRÓPRIO site diz (conferência de cobertura).
  const totalDoCatalogo = (html) => { const m = String(html || '').match(/Exibindo[\s\S]{0,200}?<\/strong>\s*de\s*<strong[^>]*>(\d+)<\/strong>/); return m ? Number(m[1]) : null; };

  function parseDetalhe(html, url, { agora = new Date() } = {}) {
    const b = corpo(html);
    const titulo = umaLinha((b.match(/<header class="lv-lote-identificacao"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
    if (!titulo) return null;
    const status = umaLinha((b.match(/<header class="lv-lote-identificacao">\s*<span class="lv-situacao[^"]*">([\s\S]*?)<\/span>\s*<h1/) || [])[1]
      || (b.match(/<span class="lv-situacao[^"]*"><span class="ponto"[^>]*><\/span>([^<]*)<\/span>/) || [])[1]);
    const resumo = (b.match(/<div class="lv-lote-resumo[\s\S]*?<div class="lv-lote-principal">/) || [''])[0];
    const rotuloPreco = umaLinha((resumo.match(/<div class="rotulo">([\s\S]*?)<\/div>/) || [])[1]);
    const preco = brl((resumo.match(/<div class="valor lv-num">([\s\S]*?)<\/div>/) || [])[1]);
    const nums = paresDl(resumo);
    const specs = paresDl((b.match(/<dl class="lv-specs">[\s\S]*?<\/dl>/) || [''])[0]);
    const avaliacao = plaus(brl(nums.get('Avaliação')));
    const pracas = [...resumo.matchAll(/<li class="lv-praca[^"]*">([\s\S]*?)<\/li>/g)].map((m) => {
      const nome = umaLinha((m[1].match(/class="nome">([\s\S]*?)<\/span>/) || [])[1]);
      const iso = dataBR(umaLinha((m[1].match(/class="data">([\s\S]*?)<\/span>/) || [])[1]));
      return { nome, iso, t: Date.parse(iso || ''), valor: plaus(brl((m[1].match(/class="valor[^"]*">([\s\S]*?)<\/span>/) || [])[1])) };
    }).filter((p) => Number.isFinite(p.t));
    const encerramento = (resumo.match(/<div class="lv-programacao-encerramento">[\s\S]*?<time dateTime="([^"]+)"/) || [])[1] || null;
    const modalidade = MODALIDADE(specs.get('Modalidade')) || (/venda\s+direta/i.test(rotuloPreco) ? 'venda_direta' : 'judicial');
    const agoraMs = +agora;
    const iVig = pracas.findIndex((p) => p.t >= agoraMs);
    const vig = iVig >= 0 ? pracas[iVig] : null;
    const prox = iVig >= 0 ? pracas[iVig + 1] || null : null;
    const fimSemPraca = !pracas.length && encerramento && Date.parse(encerramento) >= agoraMs ? encerramento : null;
    const minimo = plaus(vig?.valor) || plaus(preco) || avaliacao;

    const uf = UFS.has(String(specs.get('UF') || '').toUpperCase()) ? specs.get('UF').toUpperCase() : null;
    const descricao = semTags((b.match(/<div class="lv-prose">([\s\S]*?)<\/div>/) || [])[1]).slice(0, 8000) || null;
    const doTexto = cidadeDoTexto(`${titulo} | ${descricao || ''}`, uf);
    const cidade = cidadeIbge(specs.get('Cidade'), uf) || doTexto?.cidade || null;
    const estado = uf || doTexto?.estado || null;

    const docs = [...((b.match(/<ul class="lv-lote-docs">([\s\S]*?)<\/ul>/) || [])[1] || '').matchAll(/<a href="(https?:\/\/[^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => anexo(umaLinha(m[3]).replace(/Abrir.*$/, '').trim() || m[2], m[1]));
    const fotos = unicos([...((b.match(/<div class="lv-lote-galeria">[\s\S]*?(?=<div class="lv-lote-resumo)/) || [''])[0])
      .matchAll(/<img[^>]+src="(https:\/\/static\.suporteleiloes\.com\.br\/[^"]+\/bens\/[^"]+)"/g)].map((m) => m[1]));
    const categoria = specs.get('Categoria') || umaLinha((b.match(/<span class="cat">([^<]*)<\/span>/) || [])[1]) || null;
    const ehImovel = ehImovelPelaCategoria(categoria);
    const fechadoPeloSite = !!status && !/aberto|em\s+breve|dispon[íi]vel|recebendo|em\s+andamento|ao\s+vivo/i.test(status) && RE_FECHADO.test(status);
    const pracasVencidas = pracas.length > 0 && !vig && modalidade !== 'venda_direta';
    const id = idDaUrl(url);
    return {
      id, titulo: titulo.slice(0, 180), cidade, estado, status, categoria,
      valor_avaliacao: avaliacao, valor_minimo: minimo,
      valor_minimo_2: prox && plaus(prox.valor) && plaus(prox.valor) !== minimo ? plaus(prox.valor) : null,
      data_leilao: vig ? vig.iso.slice(0, 10) : fimSemPraca ? fimSemPraca.slice(0, 10) : null,
      data_leilao_2: prox ? new Date(prox.t).toISOString() : null,
      modalidade,
      tipo: ehImovel === false ? null : tipoDaCategoria(categoria) || inferirTipo(titulo, url),
      area_m2: extrairArea(titulo, descricao || ''),
      // O campo "Matrícula" às vezes é o CÓDIGO interno do comitente ("ALVO-SICOOB-OILEC-9400-9401-…", lote 2760-2):
      // só vale número; senão, a matrícula escrita no título/descrição ("matrícula 9.401").
      descricao, numero_matricula: (/^\d[\d.]{2,}$/.test(specs.get('Matrícula') || '') ? specs.get('Matrícula') : null)
        || (`${titulo} ${descricao || ''}`.match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?([\d][\d.]{2,})/i) || [])[1]?.replace(/\.$/, '') || null,
      numero_processo: specs.get('Processo') || null,
      anexos: docs, link_edital: docs.find((a) => a.tipo === 'edital')?.url || null,
      link_matricula: docs.find((a) => a.tipo === 'matricula')?.url || null,
      link_foto: fotos[0] || null, fotos, eh_imovel: ehImovel !== false,
      encerrado: fechadoPeloSite || pracasVencidas,
    };
  }
  const montarRow = (url, det, tenant) => linha(url, det, tenant);
  return { TENANTS, extrairUrlsDeLote, idDaUrl, totalDoCatalogo, parseDetalhe, montarRow, checarQualidade };
})();

// ══ VIX ══════════════════════════════════════════════════════════════════════════════════════════
export const VIX = (() => {
  const TENANTS = { vix: { fonte: 'VIXLEILOES', leiloeiro: 'VIX Leilões (Gabriel Fardin Pereira)', base: 'https://www.vixleiloes.com.br' } };
  const artigos = (html) => [...corpo(html).matchAll(/<article\b[\s\S]*?<\/article>/g)].map((m) => m[0]);
  // Agenda → eventos ABERTOS (o badge do card: "Aberto para lances", "Em breve", "Ao vivo", "Encerrando"). Evento
  // "Encerrado"/"Realizado em" fica fora; evento de site EXTERNO ("Acessar site externo do leilão") também — ele não
  // tem lote aqui (o da esleiloes.com.br é de outra vitrine).
  function extrairUrlsDeEvento(html, base) {
    const out = new Map();
    for (const a of artigos(html)) {
      const m = a.match(/href="(\/leiloes\/(\d+)-[^"]*)"/);
      if (!m) continue;
      const badge = umaLinha((a.match(/<span class="inline-flex items-center gap-1\.5 rounded-full[^"]*">([\s\S]*?)<\/span>/) || [])[1]);
      if (/encerrad|realizad|cancelad|suspens/i.test(badge) || (!badge && /Realizado em/i.test(a))) continue;
      if (/^\s*0\s+lotes?\b/i.test(umaLinha((a.match(/font-black text-white">([\s\S]*?)<\/span>/) || [])[1]))) continue;
      out.set(m[2], new URL(m[1], base).href);
    }
    return out;
  }
  // Lote do evento + o rótulo do card ("Caminhão · VILA VELHA — ES" → "Caminhão"). O catálogo devolve TODOS os lotes
  // (o laço de páginas do motor para na 1ª página sem lote novo: filtrar aqui faria o evento do CBMES — 80 lotes, a 1ª
  // página só de caminhão — parar na página 1 e esconder um imóvel da página 3, o erro do FREITAS). Quem separa
  // imóvel de veículo é `urlCandidata`, pelo rótulo guardado aqui.
  const CATEGORIA = new Map();
  function extrairUrlsDeLote(html, base) {
    const out = new Map();
    for (const a of artigos(html)) {
      const m = a.match(/href="(\/lote\/(\d+)-[^"]*)"/);
      if (!m) continue;
      const rotulo = umaLinha((a.match(/<div class="text-\[11\.5px\] font-bold uppercase tracking-\[\.04em\] text-vix-blue">([\s\S]*?)<\/div>/) || [])[1]);
      const url = new URL(m[1], base).href;
      CATEGORIA.set(url, rotulo.split('·')[0].trim());
      out.set(m[2], url);
    }
    return out;
  }
  // Rótulo vazio entra (o detalhe decide): perder imóvel por card sem rótulo é pior que ler uma página a mais.
  const urlCandidata = (url) => { const cat = CATEGORIA.get(url); return !cat || (RE_CAT_IMOVEL.test(cat) && !RE_CAT_VEICULO.test(cat)); };
  const urlVeiculo = (url) => RE_CAT_VEICULO.test(CATEGORIA.get(url) || '');
  const idDaUrl = (url) => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;
  const totalDoEvento = (html) => { const m = umaLinha(corpo(html)).match(/(\d+)\s+lotes?\s+encontrados?/i); return m ? Number(m[1]) : null; };

  function parseDetalhe(html, url, { agora = new Date() } = {}) {
    const b = corpo(html);
    const ld = jsonLd(html, 'Product');
    const titulo = umaLinha((b.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]) || ld?.name || '';
    if (!titulo) return null;
    const specs = paresDl(b);
    // Cabeçalho do lote: "Lote 01 · <categoria> · <tipo> · <status>" e, abaixo do título, "<bairro, cidade, UF>",
    // "<data>", "Comitente: X".
    const cab = (b.match(/<span class="rounded-lg bg-vix-blue[^"]*">Lote[\s\S]*?<\/h1>\s*<div[^>]*>([\s\S]*?)<\/div>/) || [])[0] || '';
    const pills = [...cab.matchAll(/<span class="[^"]*rounded-full[^"]*">([\s\S]*?)<\/span>/g)].map((m) => umaLinha(m[1]));
    const status = pills.find((p) => /lance|encerrad|vendid|arrematad|suspens|cancelad|breve|andamento|aguard|retirad|sem\s+licit/i.test(p)) || '';
    const linhaInfo = [...((cab.match(/<\/h1>\s*<div[^>]*>([\s\S]*?)<\/div>$/) || [])[1] || '').matchAll(/<span class="flex items-center gap-1\.5">([\s\S]*?)<\/span>/g)].map((m) => umaLinha(m[1]));
    const dataTxt = linhaInfo.find((s) => /\d{2}\/\d{2}\/\d{4}/.test(s)) || '';
    const iso = dataBR(dataTxt) || (ld?.offers?.priceValidUntil ? `${ld.offers.priceValidUntil}T23:59:00-03:00` : null);
    const aside = (b.match(/<aside\b[\s\S]*?<\/aside>/) || [''])[0];
    const lanceInicial = brl((aside.match(/Lance inicial<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/) || [])[1]) || Number(ld?.offers?.price) || 0;
    const avaliacao = plaus(brl(specs.get('Valor de avaliação')));
    const categoria = specs.get('Tipo') || specs.get('Categoria') || ld?.category || null;
    const ehImovel = ehImovelPelaCategoria(`${specs.get('Categoria') || ''} ${specs.get('Tipo') || ''}`.trim() || ld?.category);

    const [cidCampo, ufCampo] = String(specs.get('Cidade/UF') || '').split(/\s*[—–-]\s*/);
    const ufLd = ld?.isRelatedTo?.address?.addressRegion;
    const uf = [ufCampo, ufLd].map((x) => String(x || '').trim().toUpperCase()).find((x) => UFS.has(x)) || null;
    const descricao = semTags((b.match(/Descrição do lote<\/h2>\s*<div[^>]*>([\s\S]*?)<\/div>/) || [])[1]).slice(0, 8000) || ld?.description || null;
    const doTexto = cidadeDoTexto(`${titulo} | ${linhaInfo.join(' | ')} | ${descricao || ''}`, uf);
    const cidade = cidadeIbge(cidCampo, uf) || cidadeIbge(ld?.isRelatedTo?.address?.addressLocality, uf) || doTexto?.cidade || null;
    const estado = uf || doTexto?.estado || null;

    const docs = [...((b.match(/Documentos e edital<\/h2>([\s\S]*?)<\/ul>/) || [])[1] || '').matchAll(/<a href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => anexo(umaLinha(m[2]).replace(/\s*Baixar\s*$/, ''), m[1]));
    const fotos = unicos([...(Array.isArray(ld?.image) ? ld.image : []),
      ...[...b.matchAll(/<img[^>]+src="(https:\/\/static\.suporteleiloes\.com\.br\/[^"]+\/bens\/[^"]+)"/g)].map((m) => m[1])]);
    // O site não escreve a modalidade no lote (o evento diz "Imóveis"/"Público"/"Iniciativa Privada"): processo CNJ ou
    // comitente da Justiça = judicial; o resto (prefeitura, bombeiros, empresa) = extrajudicial.
    const processo = (`${titulo} ${docs.map((d) => d.nome).join(' ')} ${descricao || ''}`.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/) || [])[0] || null;
    const modalidade = MODALIDADE(`${specs.get('Modalidade') || ''} ${pills.join(' ')}`)
      || (processo || /\bTJ[A-Z]{2}\b|tribunal|vara|justi[çc]a|ju[íi]zo/i.test(`${specs.get('Comitente') || ''} ${docs.map((d) => d.nome).join(' ')}`) ? 'judicial' : 'extrajudicial');
    const t = Date.parse(iso || '');
    const fechadoPeloSite = !!status && !/aberto|em\s+breve|dispon[íi]vel|ao\s+vivo|andamento|aguard/i.test(status) && RE_FECHADO.test(status);
    const vencida = Number.isFinite(t) && t < +agora && modalidade !== 'venda_direta';
    const mat = specs.get('Matrícula') || (descricao?.match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*([\d][\d.]{2,})/i) || [])[1]?.replace(/\.$/, '') || null;
    return {
      id: idDaUrl(url), titulo: titulo.slice(0, 180), cidade, estado, status, categoria,
      endereco: specs.get('Endereço') || ld?.isRelatedTo?.address?.streetAddress || null, bairro: specs.get('Bairro') || null,
      // `cep` é varchar(8) no banco: só os dígitos ("26164-050" derrubou o upsert inteiro da VIX em 26/10).
      cep: (String(specs.get('CEP') || ld?.isRelatedTo?.address?.postalCode || '').match(/\d{5}-?\d{3}/) || [])[0]?.replace(/\D/g, '') || null,
      valor_avaliacao: avaliacao, valor_minimo: plaus(lanceInicial) || avaliacao, valor_minimo_2: null,
      data_leilao: iso ? iso.slice(0, 10) : null, data_leilao_2: null, modalidade,
      tipo: ehImovel === false ? null : tipoDaCategoria(specs.get('Tipo')) || inferirTipo(`${titulo} ${descricao || ''}`.slice(0, 300), url),
      area_m2: extrairArea(titulo, descricao || ''),
      descricao, numero_matricula: mat, numero_processo: processo, comitente: specs.get('Comitente') || null,
      anexos: docs, link_edital: docs.find((a) => a.tipo === 'edital')?.url || docs[0]?.url || null,
      link_matricula: docs.find((a) => a.tipo === 'matricula')?.url || null,
      link_foto: fotos[0] || null, fotos, eh_imovel: ehImovel !== false,
      encerrado: fechadoPeloSite || vencida,
    };
  }
  const montarRow = (url, det, tenant) => linha(url, det, tenant);
  return { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, urlCandidata, urlVeiculo, categoriaDe: (u) => CATEGORIA.get(u), totalDoEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade };
})();

// ══ PORTAL DOS LEILÕES ═══════════════════════════════════════════════════════════════════════════
export const PORTAL = (() => {
  const TENANTS = { portal: { fonte: 'PORTALDOSLEILOES', leiloeiro: 'Portal dos Leilões (Isaldo Sobral e Silva)', base: 'https://portaldosleiloes.com.br' } };
  const RE_LINK = /href="(\/lote\/([a-z0-9][a-z0-9-]*))"/g;
  function extrairUrlsDeLote(html, base) {
    const out = new Map();
    for (const m of corpo(html).matchAll(RE_LINK)) out.set(m[2], new URL(m[1], base).href);
    return out;
  }
  const idDaUrl = (url) => (String(url).match(/\/lote\/([a-z0-9][a-z0-9-]*)/) || [])[1] || null;
  // Props do painel do lote no payload RSC (`{"loteId":…,"valorInicial":…,"dataEncerra":…,"statusLabel":…}`).
  function painel(html) {
    let fluxo = '';
    for (const m of String(html || '').matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
      try { fluxo += JSON.parse(m[1]); } catch { /* pedaço ilegível: o painel ausente vira dado do HTML adiante */ }
    }
    const i = fluxo.indexOf('{"loteId":');
    if (i < 0) return null;
    let prof = 0, str = false;
    for (let j = i; j < fluxo.length; j++) {
      const c = fluxo[j];
      if (str) { if (c === '\\') j++; else if (c === '"') str = false; continue; }
      if (c === '"') str = true; else if (c === '{') prof++;
      else if (c === '}' && --prof === 0) { try { return JSON.parse(fluxo.slice(i, j + 1)); } catch { return null; } }
    }
    return null;
  }
  function specs(b) {
    const out = new Map();
    for (const m of b.matchAll(/<div class="lei-lote-spec__k">([\s\S]*?)<\/div>\s*<div class="lei-lote-spec__v">([\s\S]*?)<\/div>/g)) {
      const k = umaLinha(m[1]); if (k && !out.has(k)) out.set(k, umaLinha(m[2]));
    }
    return out;
  }
  function parseDetalhe(html, url, { agora = new Date() } = {}) {
    const b = corpo(html);
    const p = painel(html) || {};
    const ld = jsonLd(html, 'Product');
    const titulo = umaLinha((b.match(/<h1 class="lei-lote-panel__title"[^>]*>([\s\S]*?)<\/h1>/) || [])[1]) || ld?.name || '';
    if (!titulo) return null;
    const sp = specs(b);
    const linhas = new Map((Array.isArray(p.linhas) ? p.linhas : []).map((l) => [l.k, l.v]));
    const avaliacao = plaus(brl(linhas.get('Avaliação') || sp.get('Avaliação')));
    const minimo = plaus(Number(p.valorInicial) || brl(linhas.get('Lance inicial'))) || avaliacao;
    const status = p.statusLabel || sp.get('Situação') || '';
    const modalidade = p.vendaDireta ? 'venda_direta' : MODALIDADE(sp.get('Modalidade')) || 'extrajudicial';
    const fim = p.dataEncerra || p.dataLimitePropostas || null;
    const t = Date.parse(fim || '');
    const categoria = sp.get('Tipo') || sp.get('Categoria') || (umaLinha((b.match(/lei-lote-panel__meta">([\s\S]*?)<\/div>/) || [])[1]).split('·')[1] || '').trim() || null;
    const ehImovel = ehImovelPelaCategoria(categoria);
    const descricao = semTags((b.match(/<div class="lei-lote-desc">([\s\S]*?)<\/div>/) || [])[1]).slice(0, 8000) || null;
    const ufCampo = String(sp.get('UF') || '').toUpperCase();
    const uf = UFS.has(ufCampo) ? ufCampo : null;
    const doTexto = cidadeDoTexto(`${titulo} | ${sp.get('Cidade') || ''} | ${descricao || ''}`, uf);
    const fotos = unicos([...(Array.isArray(ld?.image) ? ld.image : []), ...(String(html).match(/https:\/\/static\.suporteleiloes\.com\.br\/portaldosleiloes\/[^"'\\\s)]+\.(?:jpe?g|png|webp)/gi) || [])]);
    const docs = [...b.matchAll(/<a[^>]+href="(https:\/\/static\.suporteleiloes\.com\.br\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => anexo(umaLinha(m[2]), m[1]));
    const fechadoPeloSite = !!status && !/aberto|em\s+breve|dispon[íi]vel|recebendo|andamento/i.test(status) && RE_FECHADO.test(status);
    return {
      id: idDaUrl(url), titulo: titulo.slice(0, 180), status, categoria,
      cidade: cidadeIbge(sp.get('Cidade'), uf) || doTexto?.cidade || null, estado: uf || doTexto?.estado || null,
      valor_avaliacao: avaliacao, valor_minimo: minimo, valor_minimo_2: null,
      data_leilao: Number.isFinite(t) ? new Date(t - 3 * 3600e3).toISOString().slice(0, 10) : null, data_leilao_2: null, modalidade,
      tipo: ehImovel === false ? null : tipoDaCategoria(categoria) || inferirTipo(titulo, url),
      area_m2: extrairArea(titulo, descricao || ''), descricao, comitente: sp.get('Comitente') || null,
      anexos: docs, link_edital: docs.find((a) => a.tipo === 'edital')?.url || null, link_matricula: docs.find((a) => a.tipo === 'matricula')?.url || null,
      link_foto: fotos[0] || null, fotos, eh_imovel: ehImovel !== false,
      encerrado: fechadoPeloSite || (Number.isFinite(t) && t < +agora && modalidade !== 'venda_direta'),
    };
  }
  const montarRow = (url, det, tenant) => linha(url, det, tenant);

  // ── VEÍCULOS (26/10, 2ª passada) ──────────────────────────────────────────────────────────────
  // `/lotes?categoria=Veículos` NÃO serve: o catálogo geral tem 4.133 lotes (259 páginas) de usinas, quase todos
  // "Vendido"/"Sem Licitantes", e a categoria "Veículos" só cobre 3 deles — o caminhão do mesmo leilão está em
  // "Diversos", a moto em "Motos", e `?situacao=`/`?status=` são ignorados no /lotes (medido: os mesmos 4.133).
  // O que o site DECLARA aberto é o leilão: `/leiloes?situacao=andamento` e `?situacao=proximos` (1 + 1 em 26/10:
  // a Venda Direta 2026, "49 de 49 lotes", e a Usina Porto Rico 25/11, "0 de 101" — lotes ainda não publicados).
  // Dentro do evento cada card diz o status ("Vendido", "Sem Licitantes" com `is-inativo`; "Venda Direta"/
  // "Leilão único" aberto). Só o card aberto vira URL; a data da praça é conferida no detalhe (`encerrado`).
  const RE_EVENTO = /<a class="(lei-leilao[^"]*)" href="(\/leilao\/(\d+)-[a-z0-9-]*)"/g;
  function eventosAbertos(html, base) {
    const out = new Map();
    const b = corpo(html);
    for (const m of b.matchAll(RE_EVENTO)) {
      if (/--encerrado/.test(m[1])) continue;
      const resto = b.slice(m.index, m.index + 4000);
      const st = umaLinha((resto.match(/lei-leilao__status"[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
      if (/encerrad|cancelad|suspens|finalizad|realizad/i.test(st)) continue;
      out.set(m[3], new URL(m[2], base).href);
    }
    return out;
  }
  const RE_CARD_FECHADO = /vendid|sem\s+licitante|arrematad|encerrad|cancelad|suspens|retirad|prejudicad|desert|finalizad/i;
  // Cards de lote da página (catálogo ou evento), com o status que o PRÓPRIO card declara.
  function cartoes(html, base) {
    const b = corpo(html);
    const pos = [...b.matchAll(/<a class="(lei-lote(?:\s[^"]*)?)" href="(\/lote\/([a-z0-9][a-z0-9-]*))"/g)];
    return pos.map((m, i) => {
      const seg = b.slice(m.index, i + 1 < pos.length ? pos[i + 1].index : m.index + 6000);
      const tag = umaLinha((seg.match(/lei-lote__(?:cancel|praca)">([\s\S]*?)<\/span>/) || [])[1]);
      return {
        slug: m[3], url: new URL(m[2], base).href, tag,
        categoria: umaLinha((seg.match(/lei-lote__cat">([\s\S]*?)<\/div>/) || [])[1]) || null,
        titulo: umaLinha((seg.match(/lei-lote__title">([\s\S]*?)<\/h3>/) || [])[1]) || null,
        aberto: !/\bis-inativo\b/.test(m[1]) && !RE_CARD_FECHADO.test(tag),
      };
    });
  }
  // COBERTURA (pedido do dono: "total declarado × enumerado ≥ 90%, sem isso não grave"). O site não publica
  // um total de lotes ABERTOS; publica, em cada evento, "X de Y lotes" — X = os que a página lista, Y = os do
  // leilão. Medimos cards LIDOS (de qualquer status, somados nas páginas) contra X: é o que prova que nenhuma
  // página do evento ficou para trás; o filtro de aberto vem depois, card a card. Y − X (lotes ainda não
  // publicados, ex.: Porto Rico "0 de 101") vai para o log — não é corte nosso, é o site que não mostra.
  const COB = new Map();   // id do evento → { declarado, publicado, paginas: Map(chave da página → n de cards) }
  function registrarPagina(html, cards) {
    const ev = (String(html).match(/lei-ev-tab is-active" href="\/leilao\/(\d+)-/) || [])[1];
    const cont = corpo(html).match(/lei-lf-count"><b>(\d+)<\/b>\s*de\s*(?:<!-- -->)?(\d+)/);
    if (!ev || !cont) return;
    const e = COB.get(ev) || { declarado: Number(cont[1]), publicado: Number(cont[2]), paginas: new Map() };
    // A mesma página lida duas vezes (o motor confere o vazio na página 1) não conta em dobro.
    e.paginas.set(cards.length ? `${cards[0].slug}|${cards.length}|${cards[cards.length - 1].slug}` : 'vazia', cards.length);
    COB.set(ev, e);
  }
  // Devolve TODOS os cards (o motor pagina o evento enquanto aparece lote novo — devolver só os abertos parava a
  // paginação na 1ª página sem lote aberto e a cobertura caía por nossa causa); quem decide ler é `abertoNoCard`.
  const ABERTO = new Map();   // url → o card declara aberto?
  function extrairUrlsDeLoteVeiculo(html, base) {
    const cards = cartoes(html, base);
    registrarPagina(html, cards);
    const out = new Map();
    for (const c of cards) { out.set(c.slug, c.url); ABERTO.set(c.url, (ABERTO.get(c.url) || false) || c.aberto); }
    return out;
  }
  const abertoNoCard = (url) => ABERTO.get(url) === true;
  const cobertura = {
    zerar: () => { COB.clear(); ABERTO.clear(); },
    medir: () => {
      const eventos = [...COB].map(([id, e]) => ({ id, declarado: e.declarado, publicado: e.publicado, lidos: [...e.paginas.values()].reduce((a, n) => a + n, 0) }));
      const declarado = eventos.reduce((a, e) => a + e.declarado, 0), lidos = eventos.reduce((a, e) => a + Math.min(e.lidos, e.declarado), 0);
      return { eventos, declarado, lidos, ocultos: eventos.reduce((a, e) => a + Math.max(0, e.publicado - e.declarado), 0), pct: declarado ? lidos / declarado : null };
    },
  };
  return { TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, painel, eventosAbertos, cartoes, extrairUrlsDeLoteVeiculo, abertoNoCard, cobertura };
})();

// ══ VEÍCULOS (LanceVIP e VIX) ════════════════════════════════════════════════════════════════════
// O título do lote de veículo raramente diz o tipo ("HONDA/NXR150 BROS ESD — 2011/2011", "FORD/CARGO 1933") e o
// classificador de veículo decide o tipo PELO TÍTULO — a moto e o caminhão saíam "carro". A categoria que a própria
// página declara ("Motos", "Caminhão") vira prefixo do título quando ele não diz o tipo.
const PREFIXO_VEICULO = [[/^motos?$|motocicleta/i, 'Moto'], [/caminhonete|camionete|pick/i, 'Caminhonete'],
  [/caminh[õoã]/i, 'Caminhão'], [/[ôo]nibus/i, 'Ônibus'], [/reboque|carreta/i, 'Reboque'], [/utilit|\bvan\b|furg/i, 'Utilitário']];
export function tituloVeiculo(html) {
  const b = corpo(html);
  const h1 = umaLinha((b.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
  if (!h1) return null;
  // Portal dos Leilões escreve a categoria em `lei-lote-spec` ("Tipo: Motos"), não em <dl>.
  const cat = paresDl(b).get('Categoria') || umaLinha((b.match(/lei-lote-spec__k">\s*Tipo\s*<\/div>\s*<div class="lei-lote-spec__v">([\s\S]*?)<\/div>/) || [])[1]) || '';
  const pre = (PREFIXO_VEICULO.find(([re]) => re.test(cat)) || [])[1];
  if (!pre || /moto|caminh|[ôo]nibus|reboque|carreta|utilit|van\b|furg/i.test(h1)) return h1;
  return `${pre} ${h1}`.slice(0, 180);
}
