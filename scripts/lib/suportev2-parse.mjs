/**
 * Parser puro — SUPORTE LEILÕES v2 (o front Next.js novo da Suporte; pendência 296, 24/10).
 *
 * O QUE MUDOU NO SITE. marcoantonioleiloeiro.com.br e rodrigoleiloeiro.com.br saíram do template antigo da Suporte
 * (`/eventos/leilao/.../lote/<id>/...`, card `article.lote-main`, coletado por SUPORTE_TENANTS em scraper-puppeteer.mjs)
 * para um app Next.js (App Router, servido por Cloudflare Workers) que fala com `api-v2.suporteleiloes.com.br`
 * (CSP da página; a API exige o header `Uloc-Mi` + autenticação, então NÃO é usada). As fotos e documentos continuam
 * em `static.suporteleiloes.com.br/<cliente>/bens/<id do bem>/arquivos/…` e o id do lote é o MESMO do site antigo
 * (10341, 10514… — conferido contra `sl_rodrigoleiloeiro_10341` no acervo). Zero lote desde 13/09 e 25/09: o
 * parser antigo procurava `lote-main` num HTML que não tem mais.
 *
 * UM BANCO, QUATRO VITRINES (medido 24/10 pelo banco, pg_net): os quatro sites têm `databaseClientId:
 * "marcoantonioleiloeiro.com.br"` — Marco Antônio (erpSiteId 5, sem filtro, mostra tudo), Rodrigo Collyer (2,
 * filtro "rodrigo"), Anna Luiza (3) e DCM Leilões (4, MA). Os lotes de venda direta aparecem nos quatro. Por isso é
 * UMA fonte (MARCOANTONIO), com o lote atribuído pelo `leilao.sites` do próprio lote: um site só que não é o do dono
 * do banco → leiloeiro daquele site (11086 sai Rodrigo); vários sites → o dono do banco. Antes eram 2 tenants com o
 * MESMO lote duas vezes (`sl_marcoantonioleiloeiro_10341` e `sl_rodrigoleiloeiro_10341`).
 *
 * ONDE ESTÁ O DADO. A página do lote (`/lotes/<id>`) traz o lote inteiro no payload RSC — os
 * `self.__next_f.push([1,"…"])` — como `"initialLote":{…}` (título, praças `leilao.data1..3` com `lanceInicial`,
 * `lanceInicial2`, `lanceInicial3`, avaliação, `imagens`, `documentos`, `localizacao`, `bem.tipoPai`). Detalhes do
 * formato que este parser respeita, todos vistos no HTML real:
 *  - o payload vem picado em pedaços de ~4 KB que cortam string no meio: decodifica cada push e CONCATENA antes
 *    de procurar qualquer coisa (regex direto no HTML perdeu 3 de 90 `statusLabel` no recon);
 *  - `"initialLote":null` aparece ANTES, no layout — vale o primeiro que é objeto;
 *  - `"$undefined"` = ausente; `"$2e"` = referência a uma linha de texto `2e:T<tamanho em bytes, hex>,<texto>`
 *    (a descrição em HTML), que NÃO termina em quebra de linha — o tamanho é a única fronteira; `"$$…"` = string
 *    que começa com `$`;
 *  - `localizacao.cidade` é digitada à mão: "BH", "GOV. VALADARES", "Betim/MG", "B. CRUZEIRO" (bairro), "Serra do
 *    Cipó (antigo Cardeal Mota), município de Santana do Riacho/MG". Só vale cidade que existe no IBGE para a UF.
 *
 * Catálogo: `/leiloes-de/imoveis` (lista os 45 imóveis do sitemap de 24/10, sem paginação) no site dono do banco e,
 * como nível 2, a mesma página nos sites irmãos — lote publicado só num irmão não aparece na vitrine do dono.
 */
import MUNICIPIOS from '../../api/_municipios.js';
import { decodificarEntidades } from '../../api/_texto-imovel.js';
import { inferirTipo, extrairArea, checarQualidade as checarQualidadeBase } from './leilaopro-parse.mjs';
import { plaus, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { normCidade } from './inferir-uf.mjs';

const IRMAOS_MARCOANTONIO = [
  { base: 'https://www.rodrigoleiloeiro.com.br', leiloeiro: 'Rodrigo Collyer Leilões' },
  { base: 'https://www.annaluizaleiloeira.com.br', leiloeiro: 'Anna Luiza Leiloeira' },
  { base: 'https://www.dcmleiloes.com.br', leiloeiro: 'DCM Leilões' },
];

export const TENANTS = {
  marcoantonio: {
    fonte: 'MARCOANTONIO', leiloeiro: 'Marco Antônio Leiloeiro', base: 'https://marcoantonioleiloeiro.com.br',
    irmaos: IRMAOS_MARCOANTONIO,
  },
};

const hostDe = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };

// ── RSC ──────────────────────────────────────────────────────────────────────────────────────────
// Fluxo RSC = concatenação dos pedaços decodificados. Pedaço que não é JSON válido (nunca visto) fica de fora; o
// lote é procurado no fluxo inteiro e, faltando, parseDetalhe devolve null ("parser não leu a página").
export function fluxoRsc(html) {
  let s = '';
  for (const m of String(html || '').matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { s += JSON.parse(m[1]); } catch { /* pedaço malformado: o lote ausente vira null adiante, com motivo */ }
  }
  return s;
}

// Linha de texto `<id>:T<hex>,<texto>`: o tamanho está em BYTES UTF-8.
// A linha costuma começar depois de "\n"; depois de OUTRA linha de texto ela cola no fim dela (sem separador).
export function linhaDeTexto(fluxo, id) {
  const m = new RegExp(`(?:^|\\n)${id}:T([0-9a-f]+),`).exec(fluxo) || new RegExp(`${id}:T([0-9a-f]+),`).exec(fluxo);
  if (!m) return null;
  const ini = m.index + m[0].length, bytes = parseInt(m[1], 16);
  // `bytes` caracteres têm pelo menos `bytes` bytes: corta o Buffer no tamanho exato.
  return Buffer.from(fluxo.slice(ini, ini + bytes), 'utf8').subarray(0, bytes).toString('utf8');
}

// Objeto JSON que começa em `i` (um `{`), respeitando strings — o lote vai até a chave que fecha.
function objetoEm(s, i) {
  let prof = 0, str = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (str) { if (c === '\\') j++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{') prof++;
    else if (c === '}' && --prof === 0) return s.slice(i, j + 1);
  }
  return null;
}

function resolver(v, fluxo) {
  if (Array.isArray(v)) return v.map((x) => resolver(x, fluxo));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const r = resolver(x, fluxo); if (r !== undefined) o[k] = r; }
    return o;
  }
  if (typeof v !== 'string' || v[0] !== '$') return v;
  if (v === '$undefined') return undefined;
  if (v.startsWith('$$')) return v.slice(1);
  if (v.startsWith('$D')) return v.slice(2);
  const ref = v.match(/^\$([0-9a-f]+)$/);
  if (ref) { const t = linhaDeTexto(fluxo, ref[1]); return t == null ? undefined : t; }
  return v;
}

export function loteDoHtml(html) {
  const fluxo = fluxoRsc(html);
  for (const m of fluxo.matchAll(/"initialLote":\{/g)) {
    const txt = objetoEm(fluxo, m.index + m[0].length - 1);
    if (!txt) continue;
    try { return resolver(JSON.parse(txt), fluxo); } catch { /* recorte inválido: tenta a próxima ocorrência */ }
  }
  return null;
}

// ── Catálogo ─────────────────────────────────────────────────────────────────────────────────────
// O 1º site que lista o lote dá a URL (o runner sobrescreveria pela vitrine irmã lida depois). Módulo: a
// enumeração inteira roda no mesmo processo antes do detalhe.
const PRIMEIRA_URL = new Map();
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  const origem = (() => { try { return new URL(base).origin; } catch { return base; } })();
  for (const m of String(html || '').matchAll(/href="(?:https?:\/\/[^"/]+)?\/lotes\/(\d+)(?:[?#][^"]*)?"/g)) {
    const id = m[1];
    if (!PRIMEIRA_URL.has(id)) PRIMEIRA_URL.set(id, `${origem}/lotes/${id}`);
    out.set(id, PRIMEIRA_URL.get(id));
  }
  return out;
}
export const idDaUrl = (url) => (String(url).match(/\/lotes\/(\d+)/) || [])[1] || null;

// Nível 2: a MESMA vitrine nos sites irmãos. O caminho sai do `<link rel="canonical">` da página lida — o coletor de
// veículos reaproveita este gancho com o catálogo /leiloes-de/veiculos, e um caminho fixo puxaria IMÓVEIS para lá
// (medido no seco de 24/10: 8 imóveis entraram como "carro"). Sem canônico, sem nível 2. Só na página do dono do banco.
export function extrairUrlsDeEvento(html, base) {
  const t = Object.values(TENANTS).find((x) => hostDe(x.base) === hostDe(base));
  const can = (String(html || '').match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1];
  let caminho = null;
  try { caminho = can && hostDe(can) === hostDe(base) ? new URL(can).pathname : null; } catch { caminho = null; } // canônico ilegível = sem nível 2
  if (!t || !caminho || !/^\/leiloes-de\//.test(caminho)) return new Map();
  return new Map((t.irmaos || []).map((s) => [hostDe(s.base), `${s.base}${caminho}`]));
}

// ── Detalhe ──────────────────────────────────────────────────────────────────────────────────────
const limpo = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
const texto = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const numero = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0);
const existe = (uf, nome) => !!uf && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(nome)}`);
// O nome como o IBGE conhece. Digitado sem o "de" do meio ("SANTA RITA IBITIPOCA" = Santa Rita de Ibitipoca, lote
// 11086) também vale: tenta o "de" em cada vão, nunca outra palavra.
function nomeIbge(uf, nome) {
  if (existe(uf, nome)) return nome;
  const p = String(nome || '').trim().split(/\s+/);
  for (let i = 1; i < p.length && p.length <= 5; i++) {
    const v = [...p.slice(0, i), 'de', ...p.slice(i)].join(' ');
    if (existe(uf, v)) return v;
  }
  return null;
}

// "GOV. VALADARES" → "Governador Valadares"; "Betim/MG" → "Betim"; "…, município de Santana do Riacho/MG" → "Santana do Riacho".
const ABREV = [[/^bh$/i, 'Belo Horizonte'], [/^gov\.?\s+/i, 'Governador '], [/^pres\.?\s+/i, 'Presidente '], [/^sta\.?\s+/i, 'Santa '], [/^sto\.?\s+/i, 'Santo '], [/^s\.\s*/i, 'São ']];
function cidadeDoCampo(cru, uf) {
  let c = texto(cru);
  if (!c) return null;
  const mun = c.match(/munic[íi]pio\s+de\s+([^,/()-]+)/i);
  if (mun) c = mun[1];
  c = c.replace(/\s*[/-]\s*[A-Z]{2}\s*$/, '').trim();
  for (const [re, por] of ABREV) c = c.replace(re, por);
  const n = nomeIbge(uf, c);
  return n ? titleCase(n) : null;
}
// "…PRESIDENTE OLEGÁRIO/MG" no título/descrição: o MAIOR sufixo que existe no IBGE para a UF do lote.
function cidadeDoTexto(txt, uf) {
  for (const m of String(txt || '').matchAll(/([A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){0,5})\s*[/–-]\s*([A-Z]{2})(?![A-Za-z])/g)) {
    if (uf && m[2] !== uf) continue;
    const p = m[1].trim().split(/\s+/);
    for (let i = 0; i < p.length; i++) {
      const n = nomeIbge(m[2], p.slice(i).join(' '));
      if (n) return { cidade: titleCase(n), estado: m[2] };
    }
  }
  return null;
}

// Praças: (dataN, lanceInicialN). A vigente é a 1ª que ainda não fechou; a seguinte vira a 2ª da linha.
export function pracasDoLote(l) {
  const L = l?.leilao || {};
  const valores = [l?.lanceInicial, l?.lanceInicial2, l?.lanceInicial3];
  return [L.data1, L.data2, L.data3].map((d, i) => {
    const t = Date.parse(d || '');
    if (!Number.isFinite(t)) return null;
    // Praça sem lance próprio: só a CORRENTE tem um substituto honesto (`lanceInicialVigente`).
    const v = plaus(numero(valores[i])) || (L.praca === i + 1 ? plaus(numero(l?.lanceInicialVigente)) : 0);
    return { n: i + 1, iso: String(d), t, valor: v };
  }).filter(Boolean);
}

const MODALIDADE = { LEILAO_JUDICIAL: 'judicial', LEILAO_EXTRAJUDICIAL: 'extrajudicial', VENDA_DIRETA: 'venda_direta' };
function modalidadeDe(l) {
  const m = String(l?.modalidade || l?.leilao?.modalidade || '').toUpperCase();
  if (MODALIDADE[m]) return MODALIDADE[m];
  if (l?.leilao?.vendaDireta) return 'venda_direta';
  if (l?.leilao?.judicial === true || /JUDICIAL/.test(m) && !/EXTRA/.test(m)) return 'judicial';
  return 'extrajudicial';
}

const TIPO_POR_CATEGORIA = [[/apart|cobertura|flat|kitnet/i, 'apartamento'], [/casa|sobrado|resid/i, 'casa'],
  [/rural|fazenda|s[íi]tio|ch[áa]cara|gleba/i, 'rural'], [/terreno|lote/i, 'terreno'],
  [/comercial|loja|sala|galp|pr[ée]dio|industrial|ponto|hotel|pousada/i, 'comercial']];
const tipoDaCategoria = (c) => (TIPO_POR_CATEGORIA.find(([re]) => re.test(String(c || ''))) || [])[1] || null;

// Processo CNJ sem máscara (20 dígitos, como o site grava) → NNNNNNN-DD.AAAA.J.TR.OOOO. Outro formato fica como veio.
const processo = (p) => {
  const s = texto(p);
  const d = s.replace(/\D/g, '');
  return d.length === 20 && !/[-.]/.test(s) ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16)}` : s || null;
};

function anexosDe(docs) {
  return (Array.isArray(docs) ? docs : []).filter((d) => /^https?:\/\//.test(d?.url || '')).map((d) => {
    const nome = texto(d.nome) || 'Documento';
    const t = `${d.tipo || ''} ${nome}`;
    const tipo = /matr[íi]cula|transcri[çc][ãa]o/i.test(nome) ? 'matricula' : /edital/i.test(t) ? 'edital'
      : /laudo|avalia/i.test(nome) ? 'laudo' : 'outro';
    return { tipo, nome: nome.slice(0, 120), url: d.url };
  });
}

// Leiloeiro do lote: o `leilao.sites` diz em que vitrines ele está publicado. Um irmão só → é dele (com a URL na
// vitrine dele); nenhum irmão, ou vários (venda direta nas quatro) → o dono do banco.
function atribuicao(l, tenant, url) {
  const irmaos = (tenant?.irmaos || []);
  const sites = (Array.isArray(l?.leilao?.sites) ? l.leilao.sites : []).map((s) => hostDe(s?.url)).filter(Boolean);
  const deIrmao = irmaos.filter((s) => sites.includes(hostDe(s.base)));
  if (deIrmao.length === 1) {
    const id = idDaUrl(url) || l?.id;
    return { leiloeiro: deIrmao[0].leiloeiro, url_lote: `${deIrmao[0].base}/lotes/${id}` };
  }
  return { leiloeiro: tenant?.leiloeiro || null, url_lote: url };
}

const RE_FECHADO = /vendid|arrematad|encerrad|cancelad|suspens|retirad|sem\s+licitante|prejudicad|desert|finalizad|conclu[íi]d/i;

export function parseDetalhe(html, url, { agora = new Date(), tenant = TENANTS.marcoantonio } = {}) {
  const l = loteDoHtml(html);
  if (!l || !l.id) return null;
  const L = l.leilao || {};
  const bem = l.bem || {};
  const loc = l.localizacao || {};
  const uf = /^[A-Z]{2}$/.test(texto(loc.uf).toUpperCase()) ? texto(loc.uf).toUpperCase() : null;

  const titulo = texto(l.titulo).slice(0, 180) || texto(L.titulo).slice(0, 180) || null;
  const subtitulo = texto(l.subtitulo);
  const descHtml = typeof l.descricao === 'string' ? l.descricao : '';
  const corpo = limpo(descHtml);
  // Veículo: a ficha do bem (marca/modelo/ano/placa) entra na descrição com os rótulos que lib/veiculo-do-lote.mjs lê.
  const ficha = bem.isVeiculo || /ve[íi]cul|moto|caminh|[ôo]nibus/i.test(`${bem.tipoPai || ''} ${bem.categoria || ''}`)
    ? [texto(bem.marca) || texto(bem.modelo) ? `Marca/Modelo: ${[texto(bem.marca), texto(bem.modelo)].filter(Boolean).join('/')}` : '',
      texto(bem.ano) ? `Ano: ${texto(bem.ano)}` : '', texto(bem.placa) ? `Placa: ${texto(bem.placa)}` : '',
      texto(bem.chassi) ? `Chassi: ${texto(bem.chassi)}` : '', texto(bem.km) ? `KM: ${texto(bem.km)}` : ''].filter(Boolean).join(', ')
    : '';
  const descricao = [subtitulo, corpo, ficha].filter(Boolean).join('\n').slice(0, 8000) || null;

  const avaliacao = plaus(numero(l.valorAvaliado));
  const pracas = pracasDoLote(l);
  const agoraMs = +agora;
  const iVig = pracas.findIndex((p) => p.t >= agoraMs);
  const vig = iVig >= 0 ? pracas[iVig] : null;
  const prox = iVig >= 0 ? pracas[iVig + 1] || null : null;
  const modalidade = modalidadeDe(l);
  const minimo = plaus(vig?.valor) || plaus(numero(l.lanceInicialVigente)) || plaus(numero(l.valorInicialAtual))
    || plaus(numero(l.valorMinimo)) || plaus(numero(l.lanceInicial)) || avaliacao;
  const minimo2 = prox ? plaus(prox.valor) : 0;

  // Cidade: (1) o campo, se existir no IBGE; (2) "Cidade/UF" no título, subtítulo, descrição ou endereço.
  const doCampo = cidadeDoCampo(loc.cidade, uf);
  const doTexto = doCampo ? null : cidadeDoTexto(`${titulo || ''} | ${subtitulo} | ${texto(loc.cidade)} | ${corpo} | ${texto(loc.endereco)}`, uf);
  const cidade = doCampo || doTexto?.cidade || null;
  const estado = uf || doTexto?.estado || null;

  const endereco = [texto(loc.endereco), texto(loc.numero)].filter(Boolean).join(', ') || null;
  const lat = numero(loc.latitude), lng = numero(loc.longitude);
  const coordOk = lat < 6 && lat > -34 && lng < -28 && lng > -74 && lat !== 0 && lng !== 0;

  const anexos = anexosDe(l.documentos);
  const fotos = [...new Set((Array.isArray(l.imagens) ? l.imagens : [])
    .filter((i) => /^https?:\/\//.test(i?.url || '') && (!i.tipo || /IMAGEM/i.test(i.tipo)))
    .sort((a, b) => (b.principal === true) - (a.principal === true) || numero(a.ordem) - numero(b.ordem)).map((i) => i.url))];

  const areaBem = [bem.imovel?.areaEdificada, bem.imovel?.areaTerreno].map(numero).find((v) => v > 0) || 0;
  const mat = (corpo.match(/matr[íi]cula(?:\s+imobili[áa]ria)?\s*(?:n[º°.o]*\s*)?:?\s*([\d][\d.]{2,})/i) || [])[1]?.replace(/\.$/, '') || null;

  const status = texto(l.statusLabel || l.status);
  // statusCode 1 = "Aberto para Lances"/"Disponível" em todos os 176 lotes medidos (o sitemap só lista abertos); os
  // outros códigos nunca foram vistos, então quem decide é o rótulo, não um número chutado.
  const fechadoPeloSite = RE_FECHADO.test(status);
  // Venda direta com praças vencidas segue à venda (10706: praças de 16 e 30/09 e "Disponível" em 24/10) — as datas
  // são do leilão que a precedeu, não um prazo da venda.
  const pracasVencidas = pracas.length > 0 && !vig && modalidade !== 'venda_direta';
  const ehImovel = bem.isImovel === true || /im[óo]ve/i.test(`${bem.tipoPai || ''} ${bem.tipo || ''}`);

  return {
    id: String(l.id), titulo, cidade, estado, endereco, bairro: texto(loc.bairro) || null, cep: texto(loc.cep) || null,
    latitude: coordOk ? lat : null, longitude: coordOk ? lng : null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    valor_minimo_2: minimo2 && minimo2 !== minimo ? minimo2 : null,
    data_leilao: vig ? vig.iso.slice(0, 10) : null,
    data_leilao_2: prox ? new Date(prox.t).toISOString() : null,
    modalidade,
    tipo: ehImovel ? tipoDaCategoria(bem.categoria) || inferirTipo(titulo || '', url) : null,
    area_m2: areaBem || extrairArea(`${titulo || ''} ${subtitulo}`, corpo),
    descricao, numero_matricula: mat, numero_processo: processo(l.numeroProcesso), anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: fotos[0] || null, fotos,
    comitente: texto(l.comitente?.nome) || null,
    tipo_bem: texto(bem.tipoPai) || texto(bem.tipo) || null, eh_imovel: ehImovel,
    ...atribuicao(l, tenant, url),
    encerrado: fechadoPeloSite || pracasVencidas,
  };
}

export function montarRow(url, det, tenant) {
  const base = montarRowDom(det.url_lote || url, det, tenant, det.id || idDaUrl(url), inferirTipo);
  const row = {
    ...base,
    tipo: det.tipo || base.tipo,
    url_lote: det.url_lote || url, link_edital: det.link_edital || det.url_lote || url,
    leiloeiro: det.leiloeiro || tenant.leiloeiro,
    endereco: det.endereco || null, bairro: det.bairro || null, numero_processo: det.numero_processo || null,
    valor_minimo_2: det.valor_minimo_2 || null,
    ...(det.cep ? { cep: det.cep } : {}),
    ...(det.fotos?.length ? { fotos: det.fotos } : {}),
    ...(det.latitude != null ? { latitude: det.latitude, longitude: det.longitude, geocod_nivel: 'endereco' } : {}),
  };
  // O tipo do bem dito pela PRÓPRIA fonte (veículo, "Diversos", equipamento) não vai na linha (não é coluna), mas
  // decide o descarte em checarQualidade — fora das chaves enumeráveis para não entrar no upsert.
  Object.defineProperty(row, '_tipoBem', { value: det.eh_imovel ? null : (det.tipo_bem || 'não informado'), enumerable: false });
  return row;
}

// Lote que a fonte classifica como NÃO imóvel sai como `fora_do_acervo` (permanente: o runner tira a linha gravada e
// lembra a recusa por 30 dias) — o regex de texto do runner não reconhece "Maquinário para produção de lajotas".
export function checarQualidade(row, opts) {
  if (row?._tipoBem) {
    return { ok: false, descartar: true, faltando: ['fora_do_acervo'], motivo: `a fonte classifica o bem como "${row._tipoBem}" (não imóvel)` };
  }
  return checarQualidadeBase(row, opts);
}
