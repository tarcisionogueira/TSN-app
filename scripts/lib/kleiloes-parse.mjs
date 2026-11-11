/**
 * Parser puro — KLÖCKNER LEILÕES (kleiloes.com.br, Werno Klöckner Júnior, JUCEPAR 660; Maringá/PR). Pendência 468.
 *
 * O QUE MUDOU (09/11). O site saiu do template antigo da Suporte Leilões (`/imoveis?page=N`, lote em
 * `/oferta/leilao/imoveis/<categoria>/<id>/id-<lote>/<slug>`, lido junto com o JELEILOES em lib/jeleiloes-parse.mjs) para um
 * front Next.js próprio (classes `kl-l-*`) sobre o MESMO backend da Suporte (fotos e PDFs em
 * `static.suporteleiloes.com.br/kleiloescombr/…`). O id do lote é o mesmo de antes (56301, 57851… — conferido contra
 * `kleiloes_<id>` no acervo), então o `fonte_id` não muda. Zero lote desde 09/11: /imoveis e /veiculos dão 404.
 *
 * ONDE ESTÁ O DADO (recon 11/11, HTML real em scripts/testes/fixtures/kleiloes-*):
 *  - catálogo: `/lotes?categoria=Imóveis&page=N` e `/lotes?categoria=Veículos&page=N`, server-rendered, 24 cards por página,
 *    link `/lote/<id>-<slug>` (67 imóveis em 3 páginas e 44 veículos em 2 em 11/11);
 *  - página do lote `/lote/<id>-<slug>`: tudo no payload RSC (`self.__next_f`), que o parser decodifica e concatena:
 *    o painel `{"loteId","leilaoId","valorInicial",…,"statusLabel","linhas":[{k:"1º Leilão",sub:"18/11/2026 16:00",v:"R$ …"}]}`,
 *    as fichas `kl-l-spec__k`/`kl-l-spec__v` (Tipo, Modalidade, Leilão, Situação, Avaliação, Área, Matrícula),
 *    a descrição (`kl-l-desc` → `__html`), `fotos`/`comitente`, o processo (`{"numero":…}`) e os PDFs (`kl-l-doc`).
 */
import MUNICIPIOS from '../../api/_municipios.js';
import { decodificarEntidades } from '../../api/_texto-imovel.js';
import { inferirTipo, extrairArea, checarQualidade as checarQualidadeBase } from './leilaopro-parse.mjs';
import { plaus, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { normCidade } from './inferir-uf.mjs';
import { fluxoRsc } from './suportev2-parse.mjs';

export const TENANTS = {
  kleiloes: { fonte: 'KLEILOES', leiloeiro: 'Klöckner Leilões', base: 'https://www.kleiloes.com.br' },
};

export const CAT_IMOVEIS = '/lotes?categoria=Im%C3%B3veis';
export const CAT_VEICULOS = '/lotes?categoria=Ve%C3%ADculos';

// ── Catálogo ─────────────────────────────────────────────────────────────────────────────────────
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  const origem = (() => { try { return new URL(base).origin; } catch { return base; } })();
  for (const m of String(html || '').matchAll(/href="(?:https?:\/\/[^"/]+)?\/lote\/(\d+)(-[^"?#]*)?(?:[?#][^"]*)?"/g)) {
    if (!out.has(m[1]) || m[2]) out.set(m[1], `${origem}/lote/${m[1]}${m[2] || ''}`);
  }
  return out;
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

// ── Leitura do payload ───────────────────────────────────────────────────────────────────────────
// Valor JSON (objeto ou lista) que começa em `i`, respeitando strings.
function jsonEm(s, i) {
  const abre = s[i], fecha = abre === '{' ? '}' : abre === '[' ? ']' : null;
  if (!fecha) return null;
  let prof = 0, str = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (str) { if (c === '\\') j++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{' || c === '[') prof++;
    else if ((c === '}' || c === ']') && --prof === 0) {
      try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; } // recorte inválido: o campo fica ausente
    }
  }
  return null;
}
// Primeiro objeto `{"<chave>":…}` do fluxo que tem `exige` entre as chaves.
function objetoCom(fluxo, chave, exige) {
  for (const m of fluxo.matchAll(new RegExp(`\\{"${chave}":`, 'g'))) {
    const o = jsonEm(fluxo, m.index);
    if (o && (!exige || exige in o)) return o;
  }
  return null;
}
const filhoDe = (fluxo, classe) => {
  const m = fluxo.match(new RegExp(`"className":"${classe}","children":("(?:[^"\\\\]|\\\\.)*"|\\[)`));
  if (!m) return null;
  if (m[1] === '[') return jsonEm(fluxo, m.index + m[0].length - 1);
  try { return JSON.parse(m[1]); } catch { return null; } // string malformada: ausente
};
const texto = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const textoDeFilhos = (v) => (Array.isArray(v) ? v.map(textoDeFilhos).join('') : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const limpo = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
const reais = (s) => Number(String(s || '').replace(/[^\d,]/g, '').replace(',', '.')) || 0;
// Área da ficha, digitada à mão: "437,50m²", "20.360,00m²", "41.14 m²" (ponto decimal), "54.152 m²" (milhar),
// "1.000,19m² e 2.001,81m²" (vale o 1º número). Abaixo de 10 m² não é área de imóvel ("2.54 m²" num rural) → 0.
export function area(s) {
  const n = (String(s || '').match(/\d[\d.,]*/) || [''])[0].replace(/[.,]$/, '');
  if (!n) return 0;
  let v;
  if (n.includes(',')) v = Number(n.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(n)) v = Number(n.replace(/\./g, ''));
  else v = Number(n);
  return Number.isFinite(v) && v >= 10 ? v : 0;
}

export function specsDe(fluxo) {
  const out = {};
  for (const m of fluxo.matchAll(/"kl-l-spec__k","children":"([^"]+)"\}\],\["\$","div",null,\{"className":"kl-l-spec__v","children":"((?:[^"\\]|\\.)*)"/g)) {
    try { out[m[1]] = JSON.parse(`"${m[2]}"`); } catch { out[m[1]] = m[2]; } // escape quebrado: fica o cru
  }
  return out;
}

export function documentosDe(fluxo) {
  const out = [];
  for (const m of fluxo.matchAll(/"href":"(https?:\/\/[^"]+)"[^{}]*?"className":"kl-l-doc","children":\[\["\$","span",null,\{"className":"kl-l-doc__pdf"[^}]*\}\],\["\$","span",null,\{"className":"kl-l-doc__nome"(?:,"style":\{[^}]*\})?,"children":"([^"]*)"/g)) {
    const nome = texto(m[2]) || 'Documento';
    const tipo = /matr[íi]cula|transcri[çc][ãa]o/i.test(nome) ? 'matricula' : /edital/i.test(nome) ? 'edital' : /laudo|avalia/i.test(nome) ? 'laudo' : 'outro';
    out.push({ tipo, nome: nome.slice(0, 120), url: m[1] });
  }
  return out;
}

// "18/11/2026 16:00" (horário de Brasília) → instante.
function quando(sub) {
  const m = String(sub || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? { iso, dia: `${m[3]}-${m[2]}-${m[1]}`, t } : null;
}

// Praças das `linhas` do painel ("1º Leilão", "2º Leilão"), na ordem do número.
export function pracasDe(linhas) {
  return (Array.isArray(linhas) ? linhas : [])
    .map((l) => ({ n: Number((String(l?.k || '').match(/^(\d)\s*[ºª°o]?\s*Leil/i) || [])[1]), q: quando(l?.sub), valor: plaus(reais(l?.v)) }))
    .filter((p) => p.n && p.q)
    .sort((a, b) => a.n - b.n)
    .map((p) => ({ n: p.n, iso: p.q.iso, dia: p.q.dia, t: p.q.t, valor: p.valor }));
}

// ── Cidade ───────────────────────────────────────────────────────────────────────────────────────
const existe = (uf, nome) => !!uf && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(nome)}`);
function cidadeValida(nome, uf) {
  const c = texto(nome).replace(/\s*[/-]\s*[A-Z]{2}\s*$/, '');
  return c && existe(uf, c) ? titleCase(c) : null;
}
// "município: Cianorte/PR" ou "… Campo Mourão/PR" na descrição: o MAIOR sufixo que existe no IBGE.
function cidadeDoTexto(txt) {
  for (const m of String(txt || '').matchAll(/([A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){0,5})\s*[/–-]\s*([A-Z]{2})(?![A-Za-z])/g)) {
    const p = m[1].trim().split(/\s+/);
    for (let i = 0; i < p.length; i++) {
      const n = p.slice(i).join(' ');
      if (existe(m[2], n)) return { cidade: titleCase(n), estado: m[2] };
    }
  }
  return null;
}

// ── Detalhe ──────────────────────────────────────────────────────────────────────────────────────
const TIPO_POR_CATEGORIA = [[/apart|cobertura|flat|kitnet/i, 'apartamento'], [/casa|sobrado|resid/i, 'casa'],
  [/rural|fazenda|s[íi]tio|ch[áa]cara|gleba/i, 'rural'], [/terreno|lote/i, 'terreno'],
  [/comercial|loja|sala|galp|pr[ée]dio|industrial|ponto|hotel|pousada|vaga|garagem|box/i, 'comercial']]; // vaga: como PESTANA
const tipoDaCategoria = (c) => (TIPO_POR_CATEGORIA.find(([re]) => re.test(String(c || ''))) || [])[1] || null;
const RE_NAO_IMOVEL = /moto|carro|autom[óo]v|caminh|ve[íi]cul|[ôo]nibus|utilit|trator|reboque|semirreboque|m[áa]quin|equipament|eletr|diversos|sucata|embarca/i;
const RE_FECHADO = /vendid|arrematad|encerrad|cancelad|suspens|retirad|sem\s+licitante|prejudicad|desert|finalizad|conclu[íi]d|homologad/i;
const MODALIDADE = (s) => (/venda\s+direta/i.test(s) ? 'venda_direta' : /extra/i.test(s) ? 'extrajudicial' : /judicial/i.test(s) ? 'judicial' : null);

export function parseDetalhe(html, url, { agora = new Date(), tenant = TENANTS.kleiloes } = {}) {
  const fluxo = fluxoRsc(html);
  const painel = objetoCom(fluxo, 'loteId', 'linhas');
  if (!painel || !painel.loteId) return null;

  const specs = specsDe(fluxo);
  const titulo = texto(textoDeFilhos(filhoDe(fluxo, 'kl-l-panel__title'))).slice(0, 180) || null;
  const locTxt = texto(textoDeFilhos(filhoDe(fluxo, 'kl-l-panel__loc')).replace(/📍/g, ''));
  const [locCidade, locUf] = (locTxt.match(/^(.+?)\s*-\s*([A-Z]{2})$/) || []).slice(1);
  const descObj = (() => {
    const m = fluxo.match(/"className":"kl-l-desc","dangerouslySetInnerHTML":\{"__html":("(?:[^"\\]|\\.)*")/);
    if (!m) return '';
    try { return JSON.parse(m[1]); } catch { return ''; } // __html malformado: sem descrição (montarRow sintetiza)
  })();
  const corpo = limpo(descObj);
  const galeria = objetoCom(fluxo, 'fotos', 'comitente') || {};
  const fotos = [...new Set((Array.isArray(galeria.fotos) ? galeria.fotos : []).filter((u) => /^https?:\/\//.test(u)))];
  const proc = (fluxo.match(/\{"numero":"([^"]+)"\}/) || [])[1] || null;
  const anexos = documentosDe(fluxo);

  const tipoSpec = texto(specs.Tipo);
  const modalidade = MODALIDADE(specs.Modalidade || '') || (painel.vendaDireta ? 'venda_direta' : 'judicial');
  const linhas = Array.isArray(painel.linhas) ? painel.linhas : [];
  const avaliacao = plaus(reais(linhas.find((l) => l?.tipo === 'aval')?.v)) || plaus(reais(specs['Avaliação']));
  const pracas = pracasDe(linhas);
  const agoraMs = +agora;
  const iVig = pracas.findIndex((p) => p.t >= agoraMs);
  const vig = iVig >= 0 ? pracas[iVig] : null;
  const prox = iVig >= 0 ? pracas[iVig + 1] || null : null;
  const lanceInicialLinha = plaus(reais(linhas.find((l) => /lance\s+inicial/i.test(l?.k || ''))?.v));
  const minimo = plaus(vig?.valor) || lanceInicialLinha || plaus(Number(painel.valorInicial)) || avaliacao;
  const minimo2 = prox ? plaus(prox.valor) : 0;

  // Sem praça nas `linhas` (venda direta, e alguns judiciais que só mostram "Lance inicial"): a data é o prazo das
  // propostas, quando há; senão o encerramento do lote (`dataEncerra`, o mesmo relógio do botão de lance do site).
  const encerra = quando(String(painel.dataLimitePropostas || painel.dataEncerra || '').replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}).*$/, '$3/$2/$1 $4:$5'));
  // Praças vencidas que viraram venda direta (57787 Foz do Iguaçu: praças de 26/10 e 09/11, propostas até 08/01/2027):
  // vale o prazo das propostas, não a praça que já passou.
  const semPracaValida = !pracas.length || (!vig && (modalidade === 'venda_direta' || painel.vendaDireta));
  const dataLeilao = vig ? vig.dia : (semPracaValida && encerra && encerra.t >= agoraMs ? encerra.dia : null);

  const status = texto(painel.statusLabel || specs['Situação']);
  const pracasVencidas = pracas.length > 0 && !vig && modalidade !== 'venda_direta';
  const ehImovel = !RE_NAO_IMOVEL.test(tipoSpec) && (/im[óo]vel/i.test(`${titulo || ''} ${url}`) || !!tipoDaCategoria(tipoSpec));

  const ufLoc = /^[A-Z]{2}$/.test(locUf || '') ? locUf : null;
  const doCampo = cidadeValida(locCidade, ufLoc);
  const doTexto = doCampo ? null : cidadeDoTexto(`${titulo || ''} | ${corpo}`);
  const cidade = doCampo || doTexto?.cidade || null;
  const estado = (doCampo ? ufLoc : null) || doTexto?.estado || ufLoc || null;

  const areaSpec = [specs['Área construída'], specs['Área privativa'], specs['Área útil'], specs['Área total'], specs['Área do terreno'], specs['Área']]
    .map(area).find((v) => v > 0) || 0;
  const matSpec = texto(specs['Matrícula']) || null;
  const mat = matSpec || (corpo.match(/matr[íi]cula(?:\s+imobili[áa]ria)?\s*(?:n[º°.o]*\s*)?:?\s*([\d][\d.]{2,})/i) || [])[1]?.replace(/\.$/, '') || null;

  return {
    id: String(painel.loteId), titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    valor_minimo_2: minimo2 && minimo2 !== minimo ? minimo2 : null,
    data_leilao: dataLeilao,
    data_leilao_2: prox ? new Date(prox.t).toISOString() : null,
    modalidade,
    tipo: ehImovel ? tipoDaCategoria(tipoSpec) || inferirTipo(titulo || '', url) : null,
    area_m2: areaSpec || (ehImovel ? extrairArea(titulo || '', corpo) : 0),
    descricao: corpo.slice(0, 8000) || null,
    numero_matricula: mat, numero_processo: proc, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: fotos[0] || null, fotos,
    comitente: texto(galeria.comitente) || null,
    tipo_bem: tipoSpec || null, eh_imovel: ehImovel,
    leiloeiro: tenant?.leiloeiro || null,
    status,
    encerrado: RE_FECHADO.test(status) || pracasVencidas,
  };
}

export function montarRow(url, det, tenant) {
  const base = montarRowDom(url, det, tenant, det.id || idDaUrl(url), inferirTipo);
  const row = {
    ...base,
    tipo: det.tipo || base.tipo,
    link_edital: det.link_edital || url,
    numero_processo: det.numero_processo || null,
    valor_minimo_2: det.valor_minimo_2 || null,
    ...(det.fotos?.length ? { fotos: det.fotos } : {}),
  };
  // Tipo do bem dito pela fonte: não vai na linha (não é coluna), mas decide o descarte em checarQualidade.
  Object.defineProperty(row, '_tipoBem', { value: det.eh_imovel ? null : (det.tipo_bem || 'não informado'), enumerable: false });
  return row;
}

export function checarQualidade(row, opts) {
  if (row?._tipoBem) {
    return { ok: false, descartar: true, faltando: ['fora_do_acervo'], motivo: `a fonte classifica o bem como "${row._tipoBem}" (não imóvel)` };
  }
  return checarQualidadeBase(row, opts);
}
