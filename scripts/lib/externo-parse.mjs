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
import { buscarViaBrightData, ErroBrightData } from '../../api/_brightdata.js';

export const TENANTS = {
  sanches: { fonte: 'SANCHES', leiloeiro: 'Antônio Sanches Ramos Junior (JUCESP 677)', base: 'https://www.sanchesleiloes.com.br' },
  osvaldo: { fonte: 'OSVALDO', leiloeiro: 'Osvaldo Leilões', base: 'https://www.osvaldoleiloes.com.br' },
  judhastas: { fonte: 'JUDHASTAS', leiloeiro: 'Judhastas', base: 'https://www.judhastas.com.br' },
};
const BASES = Object.values(TENANTS).map(t => t.base);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const limpa = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const reais = s => { const n = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
// Piso de R$ 10 mil: o edital cita custas e taxas (o leilão 2223 leu "R$ 1.080,00" como avaliação).
const plaus = v => (v >= 10_000 && v <= 500_000_000 ? v : 0);

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
  // Primeiro valor PLAUSÍVEL, não o primeiro que casa: "avaliado em R$ 1.080,00 de custas" vinha antes da avaliação.
  const achar = (re) => { for (const m of t.matchAll(new RegExp(re.source, 'gi'))) { const v = plaus(reais(m[1])); if (v) return v; } return 0; };
  // 22/10: o vão entre a palavra e o número era `[^R]` com a flag `i` — que barra também o "r" minúsculo:
  // "preço mínimo a seR aceito pelo Juízo é de R$ 1.750.000,00" nunca casava, e o SANCHES descartou TODOS
  // os leilões desde 13/10 ("sem nenhum lote pronto"). E a avaliação desse edital vem sem "R$"
  // ("avaliado em 3.500.000,00"). Vão = sem dígito; "R$" opcional (o piso de R$ 10 mil segura custas).
  const VAO = String.raw`[^\d]{0,80}?(?:R\$\s*)?([\d.]{1,15},\d{2})`;
  let avaliacao = achar(new RegExp(String.raw`(?:avalia(?:do|da|ção|cao)(?:\s+total)?|valor\s+da\s+avalia(?:ção|cao))` + VAO, 'i'));
  let minimo = achar(new RegExp(String.raw`(?:lance|valor|pre[çc]o)\s+m[íi]nimo` + VAO, 'i'));
  // "Fixo o preço mínimo de R$ 600.000,00 (…), referente a 60% do valor da avaliação" (TRT-2, 13/10):
  // o mínimo vem com o PERCENTUAL — a avaliação sai dele quando o edital não a escreve.
  const ref = t.match(new RegExp(RS + String.raw`[^%]{0,120}?referente\s+a\s+(\d{2,3}(?:,\d+)?)\s*%[^.]{0,40}?avalia`, 'i'));
  if (ref) { minimo = minimo || plaus(reais(ref[1])); if (!avaliacao && minimo) avaliacao = plaus(Math.round(minimo * 100 / reais(ref[2]) * 100) / 100); }
  // "vedada a alienação por valor inferior a 50% (cinquenta por cento) da avaliação, correspondente a R$ 145.000,00"
  // (SANCHES 2255/2260, 22/10): sem "não" na frente e com o valor já calculado depois do percentual.
  const veda = t.match(/inferior\s+a\s*(\d{2,3}(?:,\d+)?)\s*%[^.]{0,80}?avalia[çc][ãa]o[^.\d]{0,40}?correspondente\s+a\s+(?:R\$\s*)?([\d.]{1,15},\d{2})/i);
  if (veda && !minimo) minimo = plaus(reais(veda[2]));
  const pct = t.match(/(?:inferior\s+a|m[íi]nimo\s+de|correspondente\s+a)\s*(\d{2,3}(?:,\d+)?)\s*%[^.]{0,60}?avalia/i);
  if (!minimo && pct && avaliacao) minimo = Math.round(avaliacao * reais(pct[1]) / 100 * 100) / 100;
  // "1º leilão … por valor igual ou superior ao de sua avaliação": na 1ª praça o mínimo É a avaliação.
  if (!minimo && avaliacao && /1[ºo°]\s*leil[ãa]o[\s\S]{0,200}?igual\s+ou\s+superior\s+ao\s+de\s+sua\s+avalia/i.test(t)) minimo = avaliacao;
  return { avaliacao, minimo, pctMinimo: pct ? reais(pct[1]) : (ref ? reais(ref[2]) : null) };
}

// PDF → texto. Direto do domínio (grátis); recusado (o Osvaldo põe Cloudflare no IP do GitHub — 403,
// e o mesmo caminho NÃO existe nos outros domínios: 404, medido 13/10) → Web Unlocker pelo ledger,
// propósito `externo`. O "não" do orçamento sai NOMEADO (forma nº 5), nunca como "PDF vazio".
async function lerPdf(buf) {
  const PDFParse = await carregarPDFParse();
  const p = new PDFParse({ data: buf });
  try { return String((await p.getText())?.text || ''); }
  finally { await p.destroy().catch(() => {}); }
}
async function textoDoPdf(url) {
  const motivos = [];
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' }, signal: AbortSignal.timeout(30000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (r.ok && buf.subarray(0, 5).toString() === '%PDF-') return { texto: await lerPdf(buf), motivo: null, via: 'gratis' };
    motivos.push(`direto HTTP ${r.status}${r.ok ? ' não-PDF' : ''}`);
  } catch (e) { motivos.push(`direto: ${String(e?.message || e).slice(0, 60)}`); }
  try {
    const bd = await buscarViaBrightData(url, { proposito: 'externo', exigirOk: false, timeoutMs: 60000 });
    const buf = Buffer.from(await bd.arrayBuffer());
    if (bd.ok && buf.subarray(0, 5).toString() === '%PDF-') return { texto: await lerPdf(buf), motivo: null, via: 'brightdata' };
    motivos.push(`brightdata HTTP ${bd.status}${bd.ok ? ' não-PDF' : ''}`);
  } catch (e) {
    motivos.push(e instanceof ErroBrightData && e.semCota ? 'brightdata: SEM COTA (decisão de orçamento)' : `brightdata: ${String(e?.message || e).slice(0, 60)}`);
  }
  return { texto: '', motivo: motivos.join(' · ') };
}

// O MESMO imóvel publicado por dois leiloeiros da plataforma (13/10: Sanches 2251 = Judhastas 2253,
// 2247 = 2249, 2241 = 2242, 2255 = 2256 — título, data e valores idênticos). Entra uma vez só: o 1º
// tenant da ordem fica com ele; os seguintes saem como `encerrado` (não contam como lote da fonte).
const vistos = new Map();
const chaveImovel = (titulo, data) => `${String(titulo || '').toUpperCase().replace(/[^A-Z0-9]+/g, '')}|${data || ''}`;

const TIPO_ANEXO = [[/edital/i, 'edital'], [/matr[íi]cula/i, 'matricula'], [/avalia/i, 'laudo']];

export async function parseDetalhe(html, url, { fetchFonte } = {}) {
  const pg = lerPaginaLeilao(html);
  if (!pg.titulo) return null; // página sem o bloco do leilão (layout mudou / challenge)
  const base = new URL(url).origin;
  const chave = chaveImovel(pg.titulo, pg.data);
  const dono = vistos.get(chave);
  if (dono && dono !== base) { console.log(`[externo] ${url}: mesmo imóvel já coletado em ${dono} — fica uma vez só`); return { encerrado: true, duplicado: true }; }
  vistos.set(chave, base);
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
    const trechos = [...amostra.matchAll(/.{0,120}(?:m[íi]nim|\d{2}\s*%|R\$\s*[\d.]+,\d{2}).{0,160}/gi)].slice(0, 4).map(m => `«${m[0]}»`).join(' ');
    console.warn(`[externo] ${url}: valores incompletos (aval ${v.avaliacao}, mín ${v.minimo})${motivoPdf ? ` · PDF: ${motivoPdf}` : ''}${trechos ? ` · trechos: ${trechos}` : ''}`);
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
