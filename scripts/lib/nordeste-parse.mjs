/**
 * Parser puro — NORDESTE (nordesteleiloes.com.br, Next.js App Router/RSC). Fonte `dom`
 * com enumeração em DOIS NÍVEIS (recons 20-21/08): a home renderizada lista EVENTOS
 * (/leiloes/<id>-<slug>, varas federais/TRT-5) e cada evento lista os LOTES
 * (/lotes/<evento>-<seq>-<slug>). Sem API: 0 XHR de lote interceptável (RSC no documento).
 *
 * O SLUG do lote é rico: "128-001-imovel-rural-com-46-hectares-amargosa-bahia" →
 * tipo, área (m2 ou hectares), cidade e ESTADO POR EXTENSO. Datas no formato
 * "25 ago de 2026 às 11h"; cards "1º Leilão"/"2º Leilão" com R$ ao lado.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, tituloDeSlug, titleCase, UF_POR_NOME, anexosDeHtml, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  nordeste: { fonte: 'NORDESTE', leiloeiro: 'Nordeste Leilões', base: 'https://www.nordesteleiloes.com.br' },
};

// Nível 1: eventos na home renderizada.
export function extrairUrlsDeEvento(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/leiloes\/(\d+)-[a-z0-9-]+)["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}

// Nível 2: lotes dentro do evento renderizado.
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/lotes\/(\d+-\d+)-[a-z0-9-]+)["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lotes\/(\d+-\d+)/) || [])[1] || null;

// Sinal de imóvel no SLUG — a mesma regra que parseDetalhe usa (lista de PERMITIDAS, ver lá).
const RE_IMOVEL_SLUG = /imov|casa|apartamento|terreno|lote|galp[ãa]o|ch[áa]cara|s[íi]tio|fazenda|pr[ée]dio|sobrado|kitnet|cobertura|comercial|residencial|\d+\s*x\s*\d+\s*m?\b/i;
// FILTRO ANTES DE LER O DETALHE (30/09). O acervo (varas federais/criminais) cresceu de 17 para 398
// lotes, quase todos veículo/sucata/máquina; o motor lê só `maxLotes` (40) detalhes por rodada, na
// ordem da página — e desde 16/09 os 40 primeiros não eram imóvel: "0 prontos" todo dia, com imóvel
// mais à frente na lista. O slug já diz se é imóvel; área no slug também conta.
export function urlCandidata(url) {
  const slug = (String(url).match(/\/lotes\/([a-z0-9-]+)/i) || [])[1] || '';
  return RE_IMOVEL_SLUG.test(slug.replace(/^\d+-\d+-/, '')) || /com-[\d.,]+-?(m2|metros|hectares?|ha)\b/i.test(slug);
}

const MES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
function datasPorExtenso(txt) {
  const ds = [];
  for (const m of String(txt).matchAll(/(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.?\s+de\s+(20\d{2})/gi)) {
    const d = new Date(+m[3], MES[m[2].toLowerCase().slice(0, 3)], +m[1]);
    if (!isNaN(d)) ds.push(d);
  }
  return ds;
}

// Slug → cidade/UF/área. Estado vem POR EXTENSO no fim ("…-amargosa-bahia"); a cidade é o
// trecho entre a área (ou o tipo) e o estado. Sem estado no slug → deixa nulo (qualidade decide).
function doSlug(slug) {
  let s = String(slug || '').replace(/^\d+-\d+-/, '');
  let estado = null, resto = s;
  for (const [nome, uf] of Object.entries(UF_POR_NOME)) {
    if (s.endsWith(`-${nome}`)) { estado = uf; resto = s.slice(0, -(nome.length + 1)); break; }
  }
  // UF COLADA NA CIDADE (24/09): "…-wenceslau-guimaraesba", "…-lauro-de-freitasba" — sem hífen e
  // sem o nome por extenso. Gravava cidade "Wenceslau Guimaraesba" e estado nulo (some de /leiloes).
  if (!estado) {
    const ufs = [...new Set(Object.values(UF_POR_NOME))].map(u => u.toLowerCase());
    const m = resto.match(/-([a-z]{3,})([a-z]{2})$/);
    if (m && ufs.includes(m[2])) { estado = m[2].toUpperCase(); resto = resto.slice(0, -2); }
  }
  let area = 0;
  const ma = resto.match(/com-([\d.,]+)-?(m2|metros|hectares?|ha)\b/i) || resto.match(/([\d.,]+)(m2|ha)\b/i);
  if (ma) {
    area = num(ma[1]);
    if (/hect|^ha$/i.test(ma[2])) area *= 10_000;
  }
  // Cidade: o que sobra depois do último marcador de área/tipo — melhor esforço: últimas 1-3
  // palavras do slug sem números.
  const palavras = resto.split('-').filter(w => w && !/\d/.test(w) && !/^(m2|ha|hectares?|com|de|do|da|em|e|urbano|rural|comercial|residencial|imovel|casa|apartamento|terreno|galpao|sala|lote)$/i.test(w));
  const cidade = palavras.length ? titleCase(palavras.slice(-3).join(' ')).slice(0, 60) : null;
  return { estado, area, cidade };
}

// O LOTE COMO O SITE O GUARDA (30/09). A página é Next.js/RSC e traz o objeto do lote no payload
// (`self.__next_f`): title, avaliation, initialBid (lance da praça vigente), endereço, CEP, processo,
// closing e status. Antes o parser lia o SLUG e o TEXTO SOLTO da página — e o texto solto traz as
// descrições dos OUTROS lotes do evento: "50% do apartamento… Salvador" saiu com título sem o 50%
// (o `^[\d-]+` do slug comeu o "50-"), avaliação R$ 190 mil (a quota-parte, citada no texto) contra
// lance R$ 300 mil (desconto −58%), área 0 e data da 1ª praça depois de ela passar. O objeto diz
// avaliação 380 mil (o bem é indivisível, vai inteiro), lance 300 mil, 2ª praça 28/09, endereço e CEP.
// Achar o objeto PELO SLUG: o payload repete o lote (resumo no evento + detalhe) — fica o mais rico.
export function loteDoPayload(html, slug) {
  if (!slug) return null;
  const h = String(html || '').replace(/\\"/g, '"');
  const alvo = `"slug":"${slug}"`;
  let melhor = null;
  for (let i = h.indexOf(alvo); i >= 0; i = h.indexOf(alvo, i + 1)) {
    const ini = h.lastIndexOf('{"id":', i);
    if (ini < 0) continue;
    let prof = 0, fim = -1, emStr = false;
    for (let k = ini; k < h.length; k++) {
      const c = h[k];
      if (emStr) { if (c === '\\') k++; else if (c === '"') emStr = false; continue; }
      if (c === '"') emStr = true;
      else if (c === '{') prof++;
      else if (c === '}') { if (--prof === 0) { fim = k; break; } }
    }
    if (fim < 0) continue;
    let o;
    try { o = JSON.parse(h.slice(ini, fim + 1)); } catch { continue; } // padrao-ok: trecho do payload que não é JSON puro — tenta a próxima ocorrência
    if (o?.slug !== slug || !o.title) continue;
    if (!melhor || Object.keys(o).length > Object.keys(melhor).length) melhor = o;
  }
  return melhor;
}

const dataISO = v => (v && !isNaN(new Date(v)) ? new Date(v).toISOString().slice(0, 10) : null);

// Texto da DESCRIÇÃO deste lote: o payload guarda uma referência ("$27") ao bloco de texto dele.
// Ler o texto solto da página traria a descrição de OUTROS lotes do evento (ver loteDoPayload).
export function descricaoDoLote(html, lote) {
  const ref = (String(lote?.description || '').match(/^\$([0-9a-f]+)$/i) || [])[1];
  if (!ref) return typeof lote?.description === 'string' && !lote.description.startsWith('$') ? textoDe(lote.description) : '';
  const ib = String(html).indexOf(`"${ref}:T`);
  return ib >= 0 ? textoDe(String(html).slice(ib, ib + 12000).split('self.__next_f.push')[1] || '') : '';
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const slug = (String(url).match(/\/lotes\/([a-z0-9-]+)/i) || [])[1] || '';

  // Cards "1º Leilão … R$ X" / "2º Leilão … R$ Y": 1º = avaliação, 2º = mínimo.
  const m1 = txt.match(/1[º°ª]\s*Leil[ãa]o[^R]{0,80}?R\$\s*([\d.]+,\d{2})/i);
  const m2 = txt.match(/2[º°ª]\s*Leil[ãa]o[^R]{0,80}?R\$\s*([\d.]+,\d{2})/i);
  const mAval = txt.match(/Avalia[çc][ãa]o[^R]{0,40}R\$\s*([\d.]+,\d{2})/i);
  let avaliacao = plaus(num(mAval?.[1])) || plaus(num(m1?.[1]));
  let minimo = plaus(num(m2?.[1])) || plaus(num(m1?.[1])) || avaliacao;
  if (!avaliacao) avaliacao = minimo;

  const { estado, area, cidade } = doSlug(slug);

  // NÃO É IMÓVEL (08/09) — o acervo do NORDESTE vem de varas federais/criminais, que
  // leiloam qualquer bem apreendido: 3 rodadas de validação ao vivo acharam veículo
  // ("Veiculo Vwgol..."), sucata de moto ("Sucata...Honda Cg Titan") E maquinário
  // ("Equipamentos Industriais") na MESMA amostra pequena de 7 lotes — 3 categorias
  // diferentes de bem não-imóvel, sinal de que o acervo real desta fonte é bem mais
  // misto do que só "alguns veículos". Uma lista de palavras PROIBIDAS vira caça ao
  // gambá: sempre falta a próxima categoria (aconteceu 2x seguidas aqui). Trocado por
  // uma lista de palavras PERMITIDAS — só passa quem tem sinal de imóvel de verdade no
  // slug (tipo ou medida de área/terreno), critério mais estreito e mais estável.
  const ehImovel = area > 0 || RE_IMOVEL_SLUG.test(slug);
  if (!ehImovel) { avaliacao = 0; minimo = 0; }
  const datas = datasPorExtenso(txt).sort((a, b) => a - b);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const fut = datas.find(d => d >= hoje) || datas[datas.length - 1] || null;
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{4,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  const lote = loteDoPayload(html, slug);
  if (lote && ehImovel) {
    const av = plaus(num(lote.avaliation)), lance = plaus(num(lote.initialBid)) || plaus(num(lote.minimunSale));
    if (av) avaliacao = av;
    if (lance) minimo = lance;
    if (minimo && !avaliacao) avaliacao = minimo;
  }
  const pracas = (lote?.auction?.squares || [])
    .filter(q => !q.hidden).sort((a, b) => (a.type?.square || 0) - (b.type?.square || 0)).map(q => dataISO(q.closing)).filter(Boolean);
  const hojeISO = hoje.toISOString().slice(0, 10);
  const numeroEnd = String(lote?.number || '').trim();
  const cep = String(lote?.postalCode || '').replace(/\D/g, '');
  // Área só da descrição DESTE lote (a referência "$27" aponta o bloco de texto dele no payload).
  let areaDesc = 0;
  const ref = (String(lote?.description || '').match(/^\$([0-9a-f]+)$/i) || [])[1];
  if (ref) {
    const ib = String(html).indexOf(`"${ref}:T`);
    const bloco = ib >= 0 ? textoDe(String(html).slice(ib, ib + 8000).split('self.__next_f.push')[1] || '') : '';
    const ma = bloco.match(/[áa]rea\s+(?:privativa\s+|[úu]til\s+|constru[íi]da\s+|total\s+)?(?:de\s+)?([\d.]+,\d{1,2})\s*m(?:²|2)/i);
    if (ma) areaDesc = num(ma[1]);
  }

  return {
    titulo: lote?.title ? String(lote.title).slice(0, 180) : tituloDeSlug(slug),
    cidade: lote?.city || cidade, estado: (lote?.state && /^[A-Z]{2}$/.test(lote.state)) ? lote.state : estado,
    bairro: lote?.district || null,
    endereco: lote?.address ? [lote.address, numeroEnd].filter(Boolean).join(', ').slice(0, 200) : null,
    cep: cep.length === 8 ? cep : null,
    numero_processo: (String(lote?.process || '').match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/) || [])[0] || null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade: 'judicial',   // acervo é 100% varas federais/TRT (recon 20-21/08)
    area_m2: area || areaDesc,
    descricao: null,
    data_leilao: pracas[0] || (fut ? fut.toISOString().slice(0, 10) : null),
    data_leilao_2: pracas[1] || null,
    numero_matricula: mat, ...docs,
    encerrado: lote
      ? (lote.status?.code === 'CLOSED' || (pracas.length > 0 && !pracas.some(d => d >= hojeISO)))
      : (datas.length > 0 && !datas.some(d => d >= hoje)),
  };
}

// Endereço/bairro/CEP/processo do payload vão na linha (montarRowDom não os conhece); nulos quando
// o payload não os traz — o geocodificador usa o que houver.
export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  endereco: det.endereco || null, bairro: det.bairro || null, cep: det.cep || null, numero_processo: det.numero_processo || null,
});
export { checarQualidade };
