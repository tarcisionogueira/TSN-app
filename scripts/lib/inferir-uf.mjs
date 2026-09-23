// ─── UF QUE FALTOU NA EXTRAÇÃO — só com prova do IBGE (23/09) ─────────────────────────────
// Achado pelo invariante `estado_fora_do_padrao` (96 lotes ativos sem sigla de UF — e lote sem
// UF SOME de /leiloes). O caso grande: 50 da SUPERBID em modo loja, onde `product.location` vem
// como OBJETO sem `state`/`uf` — mas o título traz "Campinas-SP" em todo lote. Outras fontes
// (BIASI "São Paulo/SP", LEILOTECH…) têm o mesmo padrão no texto.
//
// Regra: nunca chutar. Uma UF só é aceita se o par (UF, cidade) EXISTE no dataset do IBGE:
//   1. "Cidade-UF" / "Cidade/UF" / "Cidade - UF" no título/endereço/descrição, com a cidade
//      conferida contra aquela UF (a cidade do lote, quando existe, tem de ser a mesma);
//   2. senão, a cidade do lote quando ela existe em UMA só UF ("Campo Grande" é AL e MS —
//      ambígua, fica sem UF; "Campinas" só SP).
// Devolve { uf, cidade?, via } ou null. `cidade` só vem quando o lote não tinha nenhuma.
import MUNICIPIOS from '../../api/_municipios.js';

export const normCidade = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const UFS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
const UFS_DA_CIDADE = new Map(); // "campinas" → Set(['SP'])
for (const k of Object.keys(MUNICIPIOS)) {
  const [uf, c] = k.split('|');
  if (!UFS_DA_CIDADE.has(c)) UFS_DA_CIDADE.set(c, new Set());
  UFS_DA_CIDADE.get(c).add(uf);
}
const existe = (uf, cidadeNorm) => Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${cidadeNorm}`);

// Até 5 palavras antes do separador — o candidato a cidade é o MAIOR sufixo que bate no IBGE
// ("Apto 72m² | São Paulo-SP" → testa "paulo", "sao paulo", … e fica com "sao paulo").
const RE_CIDADE_UF = /([A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){0,5})\s*[-–/]\s*([A-Z]{2})(?![A-Za-z])/g;

function doTexto(texto, cidadeNorm) {
  if (!texto) return null;
  for (const m of String(texto).matchAll(RE_CIDADE_UF)) {
    const uf = m[2];
    if (!UFS.has(uf)) continue;
    const palavras = m[1].trim().split(/\s+/);
    for (let i = 0; i < palavras.length; i++) {
      const cand = normCidade(palavras.slice(i).join(' '));
      if (!cand || !existe(uf, cand)) continue;
      if (cidadeNorm && cidadeNorm !== cand) continue; // texto fala de OUTRA cidade — não serve
      return { uf, cidadeNorm: cand, cidadeTexto: palavras.slice(i).join(' ') };
    }
  }
  return null;
}

export function inferirUF({ cidade, titulo, endereco, descricao } = {}) {
  const cn = normCidade(cidade);
  for (const t of [titulo, endereco, descricao]) {
    const r = doTexto(t, cn || null);
    if (r) return cn ? { uf: r.uf, via: 'texto' } : { uf: r.uf, cidade: r.cidadeTexto, via: 'texto' };
  }
  if (cn) {
    const ufs = UFS_DA_CIDADE.get(cn);
    if (ufs && ufs.size === 1) return { uf: [...ufs][0], via: 'cidade_unica' };
  }
  return null;
}
