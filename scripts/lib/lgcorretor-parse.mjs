/**
 * Parser puro — LG CORRETOR JUDICIAL (lgcorretorjudicial.com.br, Dr. Luciano Grizzo).
 *
 * NÃO é leilão: alienação judicial POR INICIATIVA PARTICULAR (CPC art. 880) — o juízo nomeia o
 * corretor, que vende por preço mínimo fixado, sem praça. Entra como `venda_direta`, sem data.
 * Incluída no catálogo por decisão do dono (28/09).
 *
 * Recon 28/09 pelo servidor do banco (a nuvem do Claude não alcança o site):
 *   · o site é Next.js (App Router). A API `/api/*` exige credencial (401) — NÃO é usada;
 *   · a busca PÚBLICA `/buscar?business=JUDICIAL&page=N` vem renderizada do servidor, 8 por
 *     página, e página além do fim vem vazia. 28/09: 17 imóveis em 3 páginas. `business=PRIVATE`
 *     é venda particular comum — fora do catálogo;
 *   · os dados vêm ESTRUTURADOS no payload RSC (`self.__next_f.push`): objeto `property` com
 *     id, code, price, area, zipCode, federativeUnit, city, neighborhood, propertyType e
 *     propertyMedias (fotos em blob público da Vercel). Descrição longa vem como referência
 *     `$<id>` para uma linha de texto `<id>:T<tamanho-hex>,<texto>`;
 *   · a página `/imovel/<id>` traz os DOCUMENTOS (edital de alienação, matrícula, auto de
 *     penhora e avaliação, despachos) como PDF em blob público.
 * Fixtures reais: scripts/testes/fixtures/lgcorretor-*.html.
 */

export const BASE = 'https://www.lgcorretorjudicial.com.br';
export const FONTE = 'LGCORRETOR';
export const LEILOEIRO = 'Dr. Luciano Grizzo (corretor judicial)';

// Junta os pedaços do payload RSC. Cada push é uma string JS — decodificada como JSON.
export function payloadRsc(html) {
  const partes = [];
  for (const m of String(html || '').matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try { partes.push(JSON.parse(`"${m[1]}"`)); } catch { /* pedaço malformado: ignora só ele */ }
  }
  return partes.join('');
}

// Objeto JSON que começa em `ini` (um '{'), respeitando strings — o payload é um fluxo de
// linhas, não um JSON único, então não dá para JSON.parse do todo.
function objetoEm(txt, ini) {
  let prof = 0, emStr = false, esc = false;
  for (let i = ini; i < txt.length; i++) {
    const c = txt[i];
    if (emStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') emStr = false; continue; }
    if (c === '"') emStr = true;
    else if (c === '{') prof++;
    else if (c === '}' && --prof === 0) { try { return JSON.parse(txt.slice(ini, i + 1)); } catch { return null; } }
  }
  return null;
}

// Linha de texto do RSC: `<id>:T<len-hex>,<texto>` — o tamanho é em BYTES UTF-8.
function textoRsc(payload, ref) {
  const m = payload.match(new RegExp(`(?:^|\\n)${ref}:T([0-9a-f]+),`));
  if (!m) return null;
  const ini = m.index + m[0].length;
  const bytes = Buffer.from(payload.slice(ini), 'utf8').subarray(0, parseInt(m[1], 16));
  return bytes.toString('utf8');
}

// Imóveis da página de busca (ou da home), sem repetição.
export function extrairImoveis(html) {
  const p = payloadRsc(html);
  const porId = new Map();
  let i = -1;
  while ((i = p.indexOf('"property":{', i + 1)) >= 0) {
    const o = objetoEm(p, i + '"property":'.length);
    if (!o?.id || !/^LGCJ-/.test(o.code || '') || porId.has(o.id)) continue;
    if (typeof o.description === 'string' && /^\$[0-9a-f]+$/.test(o.description)) {
      o.description = textoRsc(p, o.description.slice(1)) || '';
    }
    porId.set(o.id, o);
  }
  return [...porId.values()];
}

// PDFs da página do imóvel. Nome = arquivo sem o sufixo aleatório do blob.
export function extrairDocumentos(html) {
  const docs = new Map();
  for (const m of String(html || '').matchAll(/https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^"\s\\]+?\/documents\/([^"\s\\/]+?)-[A-Za-z0-9]{20,40}\.pdf/g)) {
    if (docs.has(m[0])) continue;
    let nome = m[1];
    try { nome = decodeURIComponent(nome); } catch { /* nome cru */ }
    docs.set(m[0], { nome: nome.slice(0, 120), url: m[0], tipo: tipoDoc(nome) });
  }
  return [...docs.values()];
}

function tipoDoc(nome) {
  if (/matr[íi]cula/i.test(nome)) return 'matricula';
  if (/edital/i.test(nome)) return 'edital';
  if (/avalia|laudo/i.test(nome)) return 'laudo';
  return 'outro';
}

const TIPO_CATALOGO = [[/apart/i, 'apartamento'], [/casa|resid[êe]ncia|sobrado|pr[ée]dio residencial/i, 'casa'],
  [/terreno|lote/i, 'terreno'], [/rural|s[íi]tio|ch[áa]cara|fazenda/i, 'rural'], [/sala|loja|comercial|galp[ãa]o|pr[ée]dio/i, 'comercial']];

export function montarRow(p, docs = []) {
  const tipoNome = p.propertyType?.name || 'Imóvel';
  const local = [p.neighborhood, p.city].filter(Boolean).join(', ');
  const titulo = `${tipoNome}${local ? ` em ${local}` : ''}${p.federativeUnit ? ` - ${p.federativeUnit}` : ''}`.slice(0, 180);
  const fotos = (p.propertyMedias || []).filter((m) => /^image\//.test(m.mimeType || 'image/')).map((m) => m.url).filter(Boolean);
  const edital = docs.find((d) => d.tipo === 'edital')?.url || null;
  const matricula = docs.find((d) => d.tipo === 'matricula')?.url || null;
  const descricao = String(p.description || '').replace(/[“”]/g, '"').replace(/\s+\n/g, '\n').trim();
  const url = `${BASE}/imovel/${p.id}`;
  return {
    fonte: FONTE, fonte_id: `lgcorretor_${p.code.replace(/^LGCJ-/, '')}`,
    titulo, tipo: TIPO_CATALOGO.find(([re]) => re.test(tipoNome))?.[1] || 'imovel',
    modalidade: 'venda_direta',
    cidade: p.city || null, estado: p.federativeUnit || null, bairro: p.neighborhood || '', endereco: '',
    cep: p.zipCode || null,
    // `price` é o preço mínimo fixado pelo juízo. A avaliação fica 0 (desconhecida) de propósito:
    // a descrição traz a do imóvel INTEIRO mesmo quando se vende fração (LGCJ-32404: "integral =
    // R$ 380.000 … 50% = R$ 190.000") — tirar dali daria número plausível e errado.
    valor_minimo: Number(p.price) || 0, valor_avaliacao: 0,
    area_m2: Number(p.area) || 0,
    descricao: `Alienação judicial por iniciativa particular (corretor nomeado pelo juízo, CPC art. 880). Código ${p.code}.\n${descricao}`.slice(0, 8000),
    link_foto: fotos[0] || null, fotos: fotos.length ? fotos : null,
    link_edital: edital, link_regras_venda: edital, link_matricula: matricula,
    anexos: docs.map(({ nome, url: u, tipo }) => ({ nome, url: u, tipo })),
    url_lote: url, leiloeiro: LEILOEIRO,
    data_leilao: null, forma_pagamento: 'a_vista',
    ativo: true, suprimido_motivo: null,
    atualizado_em: new Date().toISOString(),
  };
}
