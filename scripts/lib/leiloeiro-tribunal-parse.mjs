/**
 * LISTAS DE LEILOEIROS CREDENCIADOS NOS TRIBUNAIS → linhas de `leiloeiro_tribunal` (29/10). Funções puras: o fetch fica
 * em `scripts/importar-leiloeiros-tribunais.mjs`, os testes em `scripts/testes/leiloeiro-tribunal-parse.mjs`.
 *
 * Fontes medidas em 29/10 (não há cadastro nacional — cada tribunal publica a sua):
 *   • TJSP — POST ConsultarAuxiliaresJustica (Tipo=9), JSON Kendo, 278. O campo Nome é texto livre:
 *     "ADEMILSON CESAR TEIXEIRA - JUCESP Nº 1165 - ACT LEILÕES - WWW.CONTATO@ACTIMOVEIS.COM.BR - WWW.ACTLEILOES.COM.BR".
 *   • EXE-PJe — GET /exe-backend-api/api/consultapublicaapi/leiloeiros-habilitados por TRT. Uma linha por HABILITAÇÃO
 *     (TRT15: 460 linhas = 69 leiloeiros) → dedup por leiloeiro.id. Traz CPF: NÃO sai daqui.
 *   • TRT4 e TRT18 — planilha Google publicada em CSV, sem id: a chave é o nome normalizado.
 * Só nome, matrícula, site, UF e cidade saem daqui — o cruzamento não precisa de mais e CPF/e-mail/telefone não entram.
 */

export const TJSP_URL = 'https://www.tjsp.jus.br/AuxiliaresJustica/AuxiliarJustica/ConsultaPublica/ConsultarAuxiliaresJustica';
export const exeUrl = (trt, pagina = 1) => `https://pje.trt${trt}.jus.br/exe-backend-api/api/consultapublicaapi/leiloeiros-habilitados?pagina=${pagina}&tamanhoPagina=500`;
export const PLANILHAS = {
  TRT4: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRTfvFu-Om2Ulz_LwqynHx5WHDm1UdNvxkMl_yk5Z3LlHZrQ3jZ5LIQhg3na0HNOfjPXG4TRyKvkMTL/pub?gid=1439618247&single=true&output=csv',
  TRT18: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSVBnklwTFn0guugV0I5GLHZLvstWQ3_JaqrlIlOgHuHKwtNN58slYrYYkGIXB7GR1-O3lmcMj4FGWG/pub?output=csv',
};

/** Mesma normalização do banco (`landing_leiloeiros_oficiais`, `leiloeiro_tribunal_cruzar`): sem acento, minúsculo,
 * sem o parêntese final, só letras/dígitos separados por um espaço. */
export const normNome = (s) => String(s || '').replace(/\s*\(.*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** O nome vem com sobra: "… - JUCESP Nº 1165 - ACT LEILÕES", "Sami Raicher LEILOEIRO OFICIAL", "DANIEL MELO CRUZ  GRUPO
 * LANCE", "Ligia Seixas www.arremaxleiloes.com.br", "Thais Spagolla Fernandes-", "MARCIANO BARBIERI (leiloeiro solicitou…".
 * Corta no 1º marcador; nenhum nome de pessoa contém "leil", então a palavra com "leil" também corta (VALERO LEILÕES). */
export function limparNome(bruto) {
  const nome = String(bruto || '')
    .split(/\s+-\s*|\s*-\s+|\s*\||\s*\(|,|\s+www\.|\s+site\s|\s*-?\s*jucesp|\s+grupo\s+lance|\s+\S*leil/i)[0]
    .replace(/[\s.\-–]+$/, '').replace(/\s+/g, ' ').trim();
  // "José Valero Santos Júnior VALERO LEILÕES": a marca antes de "LEILÕES" repete um nome da pessoa — sai junto.
  const p = nome.split(' ');
  return p.length > 2 && p.slice(0, -1).some((w) => normNome(w) === normNome(p[p.length - 1])) ? p.slice(0, -1).join(' ') : nome;
}

/** Host sem www, minúsculo; e-mail não é site ("WWW.CONTATO@ACTIMOVEIS.COM.BR" no TJSP). */
export function dominioDe(s) {
  const t = String(s || '').toLowerCase().trim();
  if (!t || /@/.test(t.split(/[\s/]/)[0])) return null;
  const m = t.match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/);
  return m ? m[1].replace(/\.$/, '') : null;
}
const sitesDoTexto = (txt) => [...String(txt || '').matchAll(/(?:https?:\/\/)?www\.[a-z0-9.-]+\.[a-z]{2,}(?![a-z0-9.-]*@)/gi)]
  .filter((m) => String(txt)[m.index + m[0].length] !== '@').map((m) => dominioDe(m[0])).filter(Boolean);

const linha = (tribunal, chave, nome, extra = {}) => {
  const limpo = limparNome(nome);
  const nn = normNome(limpo);
  if (nn.length < 5 || nn.split(' ').length < 2) return null;
  const dominio = extra.site ? dominioDe(extra.site) : null;
  return { tribunal, chave: String(chave ?? nn), nome: limpo, nome_norm: nn, matricula: extra.matricula || null,
    site: dominio ? `https://${dominio}` : null, dominio, uf: extra.uf || null, cidade: extra.cidade?.trim() || null };
};

/** TJSP: { Data: [{ Codigo, Nome, … }], Total }. */
export function parseTJSP(json) {
  return (json?.Data || []).map((r) => {
    const bruto = String(r.Nome || '');
    const mat = (bruto.match(/JUCESP\s*N?[ºo°.]?\s*(\d{1,5})/i) || [])[1];
    return linha('TJSP', r.Codigo, bruto, { matricula: mat ? `JUCESP ${mat}` : null, site: sitesDoTexto(bruto)[0], uf: 'SP' });
  }).filter(Boolean);
}

/** EXE-PJe: { qtdPaginas, resultado: [{ leiloeiro: { id, nome, site, endereco: { municipio: { nome, estado: { sigla } } } } }] }. */
export function parseEXE(json, tribunal) {
  const vistos = new Set();
  const out = [];
  for (const h of json?.resultado || []) {
    const l = h?.leiloeiro || {};
    if (!l.id || vistos.has(l.id)) continue;
    vistos.add(l.id);
    const mun = l.endereco?.municipio;
    const r = linha(tribunal, l.id, l.nome, { site: l.site, uf: mun?.estado?.sigla, cidade: mun?.nome });
    if (r) out.push(r);
  }
  return out;
}

/** CSV com aspas e quebra de linha dentro do campo (as planilhas publicadas têm as duas coisas). */
export function csv(txt) {
  const linhas = []; let campo = '', l = [], aspas = false;
  const s = String(txt || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) { if (c === '"' && s[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c; }
    else if (c === '"') aspas = true;
    else if (c === ',') { l.push(campo); campo = ''; }
    else if (c === '\n') { l.push(campo); linhas.push(l); l = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || l.length) { l.push(campo); linhas.push(l); }
  return linhas;
}

/** Planilha: acha a linha de cabeçalho com "NOME" (o TRT4 tem 8 linhas de título antes) e lê pelas colunas. */
export function parsePlanilha(txt, tribunal, uf = null) {
  const ls = csv(txt);
  const ic = ls.findIndex((l) => l.some((c) => /^\s*nome\s*$/i.test(c)));
  if (ic < 0) return [];
  const cab = ls[ic].map((c) => c.toLowerCase().trim());
  const col = (re) => cab.findIndex((c) => re.test(c));
  const cN = col(/^nome$/), cS = col(/^site|endere[çc]o eletr/), cC = col(/^cidade/);
  const vistos = new Set();
  const out = [];
  for (const l of ls.slice(ic + 1)) {
    const r = linha(tribunal, null, l[cN], { site: cS >= 0 ? l[cS] : null, uf, cidade: cC >= 0 ? l[cC] : null });
    if (r && !vistos.has(r.chave)) { vistos.add(r.chave); out.push(r); }
  }
  return out;
}
