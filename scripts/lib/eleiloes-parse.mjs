/**
 * PARSER e-leiloes.com.br (13/10) — portal da infra Suporte Leilões com front-end Nuxt 3 (4º template).
 * e-leiloeiro.com.br e e-confianca.com.br são o MESMO portal (canonical = e-leiloes.com.br).
 *
 * Os dados vêm no `<script id="__NUXT_DATA__">`, no formato devalue (array achatado: cada valor
 * aponta por ÍNDICE para outros itens do array; `["ShallowReactive", n]` etc. são embrulhos do Vue).
 *   • listagem `/leilao/imoveis?page=N` (12 por página) → data['leilao-categoria-imoveis--{}'].results
 *     → cada item traz `_website.canonicalUrl` do lote;
 *   • detalhe → data['lote-<ID>'] = o MESMO objeto `lote` do leilaobrasil (bem/leilao/praças/arquivos)
 *     → reaproveita parseLoteObj() de leilaobrasil-parse.mjs.
 *
 * Diferença medida no recon (13/10, lote 38390): `valorMinimo` vem 0 e o lance da praça mora em
 * `valorInicial`/`valorInicial2`. Com a regra do leilaobrasil (mínimo = valorMinimo || avaliação), um
 * lote já na 2ª praça (R$ 183.681) sairia com o valor da 1ª (R$ 306.135) — preço errado na vitrine.
 * Por isso a praça vigente é decidida aqui pelas datas de fim de cada praça.
 */
import {
  parseLoteObj, idDaUrl, montarRow as montarRowSuporte, checarQualidade, dataDe, tsDe,
} from './leilaobrasil-parse.mjs';

export const TENANTS = {
  eleiloes: { fonte: 'ELEILOES', leiloeiro: 'e-Leilões', base: 'https://www.e-leiloes.com.br' },
};

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
const EMBRULHOS = new Set(['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef']);

// Decodificador devalue (subconjunto que o Nuxt usa). Índice negativo = constante especial
// (undefined, NaN, ±Infinity, -0) — vira null, que é o que o JSON.parse daria. Memoizado: o
// devalue reaproveita índices e pode ter ciclo.
export function decodificarNuxt(arr) {
  if (!Array.isArray(arr)) return null;
  const memo = new Map();
  const dv = (i) => {
    if (typeof i !== 'number' || i < 0) return null;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') {
        const tag = v[0];
        if (EMBRULHOS.has(tag)) { const r = dv(v[1]); memo.set(i, r); return r; }
        if (tag === 'Date' || tag === 'BigInt' || tag === 'RegExp') return v[1] ?? null;
        if (tag === 'Set') { const r = []; memo.set(i, r); for (const k of v.slice(1)) r.push(dv(k)); return r; }
        if (tag === 'Map' || tag === 'null') {
          const r = {}; memo.set(i, r);
          for (let k = 1; k + 1 < v.length; k += 2) r[String(dv(v[k]))] = dv(v[k + 1]);
          return r;
        }
        return null; // EmptyRef, NuxtError, Island… — nada que o coletor use
      }
      const r = []; memo.set(i, r);
      for (const k of v) r.push(dv(k));
      return r;
    }
    if (v && typeof v === 'object') {
      const r = {}; memo.set(i, r);
      for (const [k, idx] of Object.entries(v)) r[k] = dv(idx);
      return r;
    }
    return v ?? null;
  };
  return dv(0);
}

// Devolve `payload.data` do Nuxt, ou null quando a página não tem o bloco (mudou de front / erro).
export function dadosNuxt(html) {
  const m = String(html || '').match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return decodificarNuxt(JSON.parse(m[1]))?.data || null; } catch { return null; }
}

// Listagem: só a chave da CATEGORIA (a página também traz "featured", que mistura veículos).
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  const data = dadosNuxt(html);
  const chave = data && Object.keys(data).find(k => k.startsWith('leilao-categoria-'));
  const itens = chave ? data[chave]?.results?.result : null;
  for (const it of Array.isArray(itens) ? itens : []) {
    const u = it?._website?.canonicalUrl || it?.canonicalUrl || (it?._website?.path ? new URL(it._website.path, base).href : null);
    const id = idDaUrl(u || '');
    if (u && id) urls.set(id, u);
  }
  return urls;
}

// JSON-LD Product: availability OutOfStock = lote encerrado (vendido/sem venda) no próprio site.
function disponibilidade(html) {
  for (const m of String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      for (const o of Array.isArray(j) ? j : [j]) {
        const av = o?.offers?.availability;
        if (o?.['@type'] === 'Product' && av) return String(av);
      }
    } catch { /* bloco JSON-LD inválido: segue para o próximo — a disponibilidade é só um reforço */ }
  }
  return null;
}

const FOTO = /\.(jpe?g|png|webp)(\?|$)/i;
const DOC = /\.(pdf|docx?)(\?|$)/i;

export function parseDetalhe(html, url) {
  const data = dadosNuxt(html);
  const id = idDaUrl(url);
  const lote = data && (data[`lote-${id}`] || Object.entries(data).find(([k]) => k.startsWith('lote-'))?.[1]);
  // null = "não consegui ler esta página" (o runner conta como sem detalhe, não como encerrado).
  if (!lote || !lote.bem) return null;

  const det = parseLoteObj(lote);
  const leilao = lote.leilao || {};
  const avaliacao = det.valor_avaliacao || plaus(num(lote.valorAvaliacao ?? lote.bem.valorAvaliacao)) || plaus(num(lote.valorInicial));
  const v1 = plaus(num(lote.valorInicial)) || avaliacao;
  const v2 = plaus(num(lote.valorInicial2));
  const p1 = dataDe(leilao.dataFimPraca1), p2 = dataDe(leilao.dataFimPraca2);
  const hoje = new Date().toISOString().slice(0, 10);
  if (p2 && p1 && p2 > p1 && p1 < hoje) {
    // 1ª praça já passou sem venda: vale a 2ª (data e lance mínimo dela).
    Object.assign(det, { data_leilao: p2, valor_minimo: v2 || v1, data_leilao_2: null, valor_minimo_2: null });
  } else if (p1) {
    const tem2 = p2 && p2 > p1;
    Object.assign(det, {
      data_leilao: p1, valor_minimo: v1,
      data_leilao_2: tem2 ? tsDe(leilao.dataFimPraca2) : null,
      valor_minimo_2: tem2 && v2 && v2 !== v1 ? v2 : null,
    });
  } else {
    det.valor_minimo = det.valor_minimo || v1;
  }
  det.valor_avaliacao = avaliacao;

  const arquivos = (Array.isArray(lote.bem.arquivos) ? lote.bem.arquivos : []).map(a => a?.url).filter(Boolean);
  det.fotos = arquivos.filter(u => FOTO.test(u));
  const docsLeilao = (Array.isArray(leilao.documentos) ? leilao.documentos : []).map(a => a?.url).filter(Boolean);
  const edital = leilao?._urls?.edital || docsLeilao[0] || null;
  det.link_edital = edital || det.link_edital;
  det.anexos = [...new Set([...docsLeilao, ...arquivos.filter(u => DOC.test(u))])]
    .map(u => (u === edital ? { tipo: 'edital', nome: 'Edital', url: u } : { tipo: 'documento', nome: 'Documento do lote', url: u }));
  det.encerrado = /OutOfStock|SoldOut|Discontinued/i.test(disponibilidade(html) || '');
  return det;
}

export function montarRow(url, det, tenant) {
  const row = montarRowSuporte(url, det, tenant);
  if (det.fotos?.length) { row.fotos = det.fotos; row.link_foto = row.link_foto || det.fotos[0]; }
  if (det.anexos?.length) row.anexos = det.anexos;
  return row;
}

export { idDaUrl, checarQualidade };
