/**
 * PARSER plataforma Leiloar "/externo/" — modelo `listagem-bens-responsivo` (13/10, #38).
 * Tenants: sanchesleiloes, osvaldoleiloes, judhastas (delano e são caetano sem leilão ativo).
 * Backend único (ids de leilão globais: 2223…2257 espalhados pelos três domínios).
 *
 * Aqui o LEILÃO É o imóvel — a página não lista lotes:
 *   • home → "LEILÕES ATUAIS" → `/externo/leilao/<id>`;
 *   • página do leilão → badge de status (ABERTO/ENCERRADO…), título em <h6><strong> ("TERRENO 125,00M² |
 *     ITANHAÉM/SP | ALIENAÇÃO POR INICIATIVA PARTICULAR TRT 2ª REGIÃO"), Data, LOCAL e o
 *     `cabecalho_id` (≠ id do leilão: 2255 → 2256);
 *   • `/externo/arquivos/<cabecalho>` → tabela NOMEADA (Edital · Auto de Avaliação · Matrícula ·
 *     Certidão de Penhora). O botão "Imprimir" da página do leilão aponta um PDF qualquer (no 2255 é a
 *     MATRÍCULA) — não serve como edital;
 *   • AVALIAÇÃO e LANCE MÍNIMO só existem no TEXTO do edital (e do auto de avaliação) em PDF.
 * Sem valor lido = det sem valor → o checarQualidade descarta (nunca inventa preço).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { numeroMatriculaDoTexto, extrairAreaM2 } from '../../api/_texto-imovel.js';
import { carregarPDFParse } from '../../api/_pdf-safe.js';

export const TENANTS = {
  sanches: { fonte: 'SANCHES', leiloeiro: 'Antônio Sanches Ramos Junior (JUCESP 677)', base: 'https://www.sanchesleiloes.com.br' },
  osvaldo: { fonte: 'OSVALDO', leiloeiro: 'Osvaldo Leilões', base: 'https://www.osvaldoleiloes.com.br' },
  judhastas: { fonte: 'JUDHASTAS', leiloeiro: 'Judhastas', base: 'https://www.judhastas.com.br' },
};
const BASES = Object.values(TENANTS).map(t => t.base);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const limpa = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const reais = s => { const n = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const plaus = v => (v >= 1000 && v <= 500_000_000 ? v : 0);

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/externo\/leilao\/(\d+))["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* href inválido: ignora */ }
  }
  return urls;
}

export const idDaUrl = url => (String(url).match(/\/externo\/leilao\/(\d+)/) || [])[1] || null;

// Página do leilão: só o que ela tem (título, status, data, local, cabeçalho).
export function lerPaginaLeilao(html) {
  const h = String(html || '');
  const status = limpa((h.match(/<div class="badge[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]).toUpperCase() || null;
  const titulo = limpa((h.match(/<h6[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i) || [])[1]) || null;
  const mData = limpa((h.match(/<b>\s*Data\s*<\/b>\s*<p>([\s\S]*?)<\/p>/i) || [])[1]).match(/(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}:\d{2}))?/);
  const local = limpa((h.match(/<b>\s*LOCAL:\s*<\/b>([^<]*)/i) || [])[1]) || null;
  const cabecalho = (h.match(/name="data\[Bem\]\[cabecalho_id\]"\s+value="(\d+)"/i) || h.match(/\/externo\/arquivos\/(\d+)/i) || [])[1] || null;
  return {
    status, titulo, local, cabecalho,
    data: mData ? `${mData[3]}-${mData[2]}-${mData[1]}` : null,
    hora: mData?.[4] || null,
  };
}

// Tabela de arquivos NOMEADA: [{ nome, url }].
export function lerArquivos(html, base) {
  const out = [];
  for (const m of String(html || '').matchAll(/<tr>\s*<td>([^<]{2,80})<\/td>\s*<td>[^<]*<\/td>\s*<td>\s*<a href="([^"]+)"/gi)) {
    try { out.push({ nome: limpa(m[1]), url: new URL(m[2], base).href }); } catch { /* href inválido: ignora */ }
  }
  return out;
}

// Cidade/UF do título ("… | ITANHAÉM/SP | …") ou do LOCAL ("ITANHAEM-SP").
export function cidadeUf(titulo, local) {
  const t = String(titulo || '').match(/\|\s*([A-ZÀ-Ú][A-ZÀ-Ú' .-]{1,40}?)\s*\/\s*([A-Z]{2})\s*(?:\||$)/i);
  if (t) return { cidade: t[1].trim(), uf: t[2].toUpperCase() };
  const l = String(local || '').match(/^\s*([A-ZÀ-Ú][A-ZÀ-Ú' .]{1,40}?)\s*[-/]\s*([A-Z]{2})\s*$/i);
  return l ? { cidade: l[1].trim(), uf: l[2].toUpperCase() } : { cidade: null, uf: null };
}

// VALORES do texto do edital/auto. Iniciativa particular TRT costuma trazer "avaliado em R$ X" e o mínimo
// como valor ("lance mínimo: R$ Y") ou como percentual ("não inferior a 50% da avaliação").
const RS = String.raw`R\$\s*([\d.]{1,15},\d{2})`;
export function valoresDoTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const achar = (re) => { const m = t.match(re); return m ? plaus(reais(m[1])) : 0; };
  const avaliacao = achar(new RegExp(String.raw`(?:avalia(?:do|da|ção|cao)(?:\s+total)?|valor\s+da\s+avalia(?:ção|cao))[^R]{0,80}?` + RS, 'i'));
  let minimo = achar(new RegExp(String.raw`(?:lance|valor|pre[çc]o)\s+m[íi]nimo[^R]{0,80}?` + RS, 'i'));
  const pct = t.match(/(?:n[ãa]o\s+inferior\s+a|m[íi]nimo\s+de|correspondente\s+a)\s*(\d{2,3}(?:,\d+)?)\s*%[^.]{0,60}?avalia/i);
  if (!minimo && pct && avaliacao) minimo = Math.round(avaliacao * reais(pct[1]) / 100 * 100) / 100;
  return { avaliacao, minimo, pctMinimo: pct ? reais(pct[1]) : null };
}

// PDF → texto. Direto do domínio; challenge/HTML no lugar do PDF (osvaldo põe Cloudflare no IP do
// GitHub) → tenta o MESMO caminho nos outros domínios da plataforma (backend único).
async function textoDoPdf(url) {
  const caminho = (() => { try { const u = new URL(url); return u.pathname; } catch { return null; } })();
  const candidatos = [url, ...(caminho ? BASES.map(b => b + caminho).filter(u => u !== url) : [])];
  const motivos = [];
  for (const u of candidatos) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' }, signal: AbortSignal.timeout(30000) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || buf.subarray(0, 5).toString() !== '%PDF-') { motivos.push(`${new URL(u).host} HTTP ${r.status}${r.ok ? ' não-PDF' : ''}`); continue; }
      const PDFParse = await carregarPDFParse();
      const p = new PDFParse({ data: buf });
      try { return { texto: String((await p.getText())?.text || ''), motivo: null }; }
      finally { await p.destroy().catch(() => {}); }
    } catch (e) { // padrao-ok: o motivo vai para `motivos` e sai no retorno (e no log do parser)
      motivos.push(`${u.slice(8, 40)}: ${String(e?.message || e).slice(0, 60)}`); }
  }
  return { texto: '', motivo: motivos.join(' · ') || 'sem candidato' };
}

const TIPO_ANEXO = [[/edital/i, 'edital'], [/matr[íi]cula/i, 'matricula'], [/avalia/i, 'laudo']];

export async function parseDetalhe(html, url, { fetchFonte } = {}) {
  const pg = lerPaginaLeilao(html);
  if (!pg.titulo) return null; // página sem o bloco do leilão (layout mudou / challenge)
  const base = new URL(url).origin;
  let arquivos = [];
  if (pg.cabecalho && fetchFonte) {
    const r = await fetchFonte(`${base}/externo/arquivos/${pg.cabecalho}`, { semBD: true });
    if (r?.html) arquivos = lerArquivos(r.html, base);
    else console.warn(`[externo] arquivos ${pg.cabecalho}: ${r?.via || 'sem resposta'}`);
  }
  const doc = re => arquivos.find(a => re.test(a.nome))?.url || null;
  const edital = doc(/edital/i), auto = doc(/avalia/i), matricula = doc(/matr[íi]cula/i);

  // Valores: edital primeiro; o que faltar, do auto de avaliação. Motivo da falta vai para o log.
  let v = { avaliacao: 0, minimo: 0, pctMinimo: null }, textoEdital = '', motivoPdf = null;
  for (const u of [edital, auto].filter(Boolean)) {
    const { texto, motivo } = await textoDoPdf(u);
    if (!texto) { motivoPdf = motivo; continue; }
    if (u === edital) textoEdital = texto;
    const w = valoresDoTexto(texto);
    v = { avaliacao: v.avaliacao || w.avaliacao, minimo: v.minimo || w.minimo, pctMinimo: v.pctMinimo ?? w.pctMinimo };
    if (v.avaliacao && v.minimo) break;
  }
  if (v.avaliacao && !v.minimo && v.pctMinimo) v.minimo = Math.round(v.avaliacao * v.pctMinimo) / 100;
  if (!v.avaliacao || !v.minimo) {
    const amostra = textoEdital.replace(/\s+/g, ' ');
    const i = amostra.search(/avalia|lance|m[íi]nimo/i);
    console.warn(`[externo] ${url}: valores incompletos (aval ${v.avaliacao}, mín ${v.minimo})${motivoPdf ? ` · PDF: ${motivoPdf}` : ''}${i >= 0 ? ` · trecho: «${amostra.slice(Math.max(0, i - 80), i + 320)}»` : ''}`);
  }

  const { cidade, uf } = cidadeUf(pg.titulo, pg.local);
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  return {
    titulo: pg.titulo.replace(/\s*\|\s*/g, ' · '),
    cidade, estado: uf,
    descricao: [pg.titulo, textoEdital.replace(/\s+/g, ' ').slice(0, 6000)].filter(Boolean).join('\n\n') || null,
    valor_avaliacao: v.avaliacao, valor_minimo: v.minimo, // sem mínimo lido = descarte, nunca a avaliação no lugar
    area_m2: extrairAreaM2(pg.titulo) || 0,
    numero_matricula: numeroMatriculaDoTexto(textoEdital),
    data_leilao: pg.data,
    modalidade: 'judicial',
    link_edital: edital, link_matricula: matricula,
    anexos: arquivos.map(a => ({ tipo: TIPO_ANEXO.find(([re]) => re.test(a.nome))?.[1] || 'documento', nome: a.nome, url: a.url })),
    // Fora: status diferente de ABERTO/EM ANDAMENTO, ou data já passada.
    encerrado: (pg.status && !/ABERTO|ANDAMENTO|LOTEAMENTO|BREVE/.test(pg.status)) || (pg.data && pg.data < hoje),
  };
}

export function montarRow(url, det, tenant) {
  const id = idDaUrl(url);
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  return {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${id}`,
    titulo: det.titulo, tipo: inferirTipo(det.titulo || '', url), modalidade: det.modalidade,
    cidade: det.cidade, estado: det.estado, endereco: null, bairro: null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url, url_lote: url, link_foto: null,
    numero_matricula: det.numero_matricula || null, link_matricula: det.link_matricula || null,
    anexos: det.anexos || [],
    leiloeiro: tenant.leiloeiro,
    data_leilao: det.data_leilao, data_leilao_2: null, valor_minimo_2: null,
    forma_pagamento: 'a_vista', ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

export { checarQualidade };
