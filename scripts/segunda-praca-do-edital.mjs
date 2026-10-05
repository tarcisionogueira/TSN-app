/**
 * #37 (05/10): valor da 2ª praça lido do EDITAL guardado no nosso bucket.
 * EM SECO por padrão (só imprime). PRACA2_APLICAR=1 grava `valor_minimo_2` onde está nulo.
 * Mede por fonte: lidos (texto extraído) · achou (regra da 2ª praça) · gravados.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: PRACA2_N (200), PRACA2_FONTE, PRACA2_APLICAR.
 */
import { createClient } from '@supabase/supabase-js';
import { extrairSegundaPraca } from '../api/_segunda-praca.js';
import { ehDocMultiLote } from '../api/_edital-extrato.js';
import { normalizarDocumento } from '../api/_doc-normalizar.js';
import { carregarPDFParse } from '../api/_pdf-safe.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(2); }
const sb = createClient(SB_URL, SB_KEY);
const N = Number(process.env.PRACA2_N || 200);
const FONTE = (process.env.PRACA2_FONTE || '').trim();
const APLICAR = process.env.PRACA2_APLICAR === '1';

// Candidatos: lote ativo, sem valor da 2ª praça, com avaliação, fora da Caixa — paginado (teto 1.000).
const lotes = [];
for (let de = 0; lotes.length < N * 3; de += 1000) {
  let q = sb.from('imoveis_leilao').select('id,fonte,valor_minimo,valor_avaliacao')
    .eq('ativo', true).is('valor_minimo_2', null).not('valor_avaliacao', 'is', null)
    .not('fonte', 'in', '("CEF","caixa")').order('id').range(de, de + 999);
  if (FONTE) q = q.eq('fonte', FONTE);
  const { data, error } = await q;
  if (error) { console.error('acervo:', error.message); process.exit(1); }
  lotes.push(...data);
  if (data.length < 1000) break;
}
const porId = new Map(lotes.map((l) => [l.id, l]));
const anexos = [];
const ids = [...porId.keys()];
for (let i = 0; i < ids.length && anexos.length < N; i += 150) {
  const { data, error } = await sb.from('imovel_anexos').select('imovel_id,storage_path,nome')
    .eq('tipo', 'edital').not('storage_path', 'is', null).in('imovel_id', ids.slice(i, i + 150));
  if (error) { console.error('anexos:', error.message); process.exit(1); }
  anexos.push(...data);
}
console.log(`${lotes.length} lotes sem 2ª praça · ${anexos.length} com edital guardado · amostra ${Math.min(N, anexos.length)} · ${APLICAR ? 'APLICANDO' : 'EM SECO'}`);

const PDFParse = await carregarPDFParse();
const cacheTexto = new Map();
async function texto(path) {
  if (cacheTexto.has(path)) return cacheTexto.get(path);
  const { data, error } = await sb.storage.from('documentos').download(path);
  if (error || !data) { cacheTexto.set(path, { erro: `download: ${error?.message || 'vazio'}` }); return cacheTexto.get(path); }
  const buf = Buffer.from(await data.arrayBuffer());
  let t = '';
  try {
    if (buf.slice(0, 4).toString() === '%PDF') {
      const p = new PDFParse({ data: buf }); try { t = String((await p.getText()).text || ''); } finally { await p.destroy().catch(() => {}); }
    } else {
      const n = await normalizarDocumento(buf, { url: path });
      t = n?.texto || '';
    }
  } catch (e) { cacheTexto.set(path, { erro: `parse: ${String(e?.message || e).slice(0, 60)}` }); return cacheTexto.get(path); }
  const r = t.replace(/\s+/g, '').length < 200 ? { erro: 'sem camada de texto' } : { t };
  cacheTexto.set(path, r);
  return r;
}

const stat = {};
const exemplos = [];
let gravados = 0, falhasGravar = 0;
for (const a of anexos.slice(0, N)) {
  const l = porId.get(a.imovel_id);
  const s = (stat[l.fonte] ||= { amostra: 0, lidos: 0, achou: 0, gravados: 0, pcts: {} });
  s.amostra++;
  const r = await texto(a.storage_path);
  if (r.erro) continue;
  s.lidos++;
  const res = extrairSegundaPraca(r.t, { multiLote: ehDocMultiLote(r.t), valorAvaliacao: l.valor_avaliacao, valorMinimo: l.valor_minimo });
  if (!res) continue;
  s.achou++;
  s.pcts[res.pct] = (s.pcts[res.pct] || 0) + 1;
  if (exemplos.length < 25) exemplos.push({ fonte: l.fonte, id: l.id, pct: res.pct, valor: res.valor, v1: l.valor_minimo, aval: l.valor_avaliacao, trecho: res.trecho.slice(0, 180) });
  // Só grava o que ACRESCENTA: em muitas fontes o "lance mínimo" coletado já É o da 2ª praça
  // (ZUK/GRUPOLANCE/MEGA mostram a praça corrente) — repetir o mesmo valor como 2ª praça não informa nada.
  const acrescenta = res.valor > 0 && (!(l.valor_minimo > 0) || res.valor < l.valor_minimo * 0.98);
  if (!acrescenta) s.jaEra2a = (s.jaEra2a || 0) + 1;
  if (APLICAR && acrescenta) {
    const { data, error } = await sb.from('imoveis_leilao').update({ valor_minimo_2: res.valor })
      .eq('id', l.id).is('valor_minimo_2', null).select('id');
    if (error || !data?.length) { falhasGravar++; console.error('gravar', l.id, error?.message || 'nenhuma linha'); } else { gravados++; s.gravados++; }
  }
}
console.table(Object.entries(stat).map(([fonte, s]) => ({ fonte, ...s, pcts: JSON.stringify(s.pcts) })));
for (const e of exemplos) console.log(`${e.fonte} ${e.id} → ${e.pct}% = ${e.valor} (1ª ${e.v1}, aval ${e.aval}) :: ${e.trecho}`);
console.log(`gravados ${gravados}, falhas ${falhasGravar}`);
if (falhasGravar) process.exit(1);
