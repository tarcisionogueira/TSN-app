// TEMPORÁRIO (03/10) — diagnóstico: por que 4 lotes ZUK do leilão 37728 receberam a mesma matrícula/identidade.
// Remover após o conserto. Só imprime texto de documento público (edital/matrícula), nunca credencial.
import { createClient } from '@supabase/supabase-js';
import { carregarPDFParse } from '../api/_pdf-safe.js';
import { ehDocMultiLote, isolarBlocoDoLote } from '../api/_edital-extrato.js';
import { extrairMatriculaTexto, extrairIdentidadeTexto } from '../api/_doc-extracao.js';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: lotes, error } = await sb.from('imoveis_leilao').select('id, cidade, titulo, valor_minimo, valor_avaliacao').like('url_lote', '%/37728-%');
if (error) throw new Error('lotes: ' + error.message);
console.log('LOTES', JSON.stringify(lotes));
const { data: anexos, error: e2 } = await sb.from('imovel_anexos').select('imovel_id, tipo, storage_path').in('imovel_id', lotes.map(l => l.id));
if (e2) throw new Error('anexos: ' + e2.message);
const paths = [...new Set(anexos.map(a => `${a.tipo}|${a.storage_path}`))];
const PDFParse = await carregarPDFParse();
for (const p of paths) {
  const [tipo, path] = p.split('|');
  const { data: blob, error: e3 } = await sb.storage.from('documentos').download(path);
  if (e3) { console.log('DOWNLOAD FALHOU', path, e3.message); continue; }
  const parser = new PDFParse({ data: Buffer.from(await blob.arrayBuffer()) });
  let txt = '';
  try { txt = String((await parser.getText())?.text || '').slice(0, 120000); } finally { await parser.destroy().catch(() => {}); }
  console.log(`\n===== ${tipo} ${path} · ${txt.length} chars · ehDocMultiLote=${ehDocMultiLote(txt)}`);
  const marcas = [...txt.matchAll(/\bLotes?\s*(?:n[ºo°.]?)?\s*:?\s*\d+\b/gi)].slice(0, 30);
  console.log('MARCAS "Lote N" (isolar):', marcas.length, marcas.map(m => JSON.stringify(txt.slice(Math.max(0, m.index - 30), m.index + 50))).join('\n   '));
  const enum_ = [...txt.matchAll(/(?:^|[\n.;]\s*|\s{2,})Lotes?\s*(?:n[ºo°.]?\s*)?0?(\d{1,3})\s*[)\-–:]/gi)].map(m => m[1]);
  console.log('ENUMERACAO (multi):', JSON.stringify(enum_.slice(0, 30)));
  const mats = [...txt.matchAll(/matr[ií]cula[^\d]{0,30}(\d[\d.]{2,9})/gi)].slice(0, 20).map(m => m[1]);
  console.log('MATRICULAS citadas:', JSON.stringify(mats));
  for (const l of lotes) {
    const bloco = isolarBlocoDoLote(txt, { valorMinimo: l.valor_minimo, valorAvaliacao: l.valor_avaliacao });
    console.log(`  lote ${l.cidade} (min ${l.valor_minimo}, aval ${l.valor_avaliacao}) → bloco ${bloco ? bloco.length + ' chars: ' + JSON.stringify(bloco.slice(0, 160)) : 'null'}`);
  }
  console.log('EXTRAI(texto inteiro) matricula=', JSON.stringify(extrairMatriculaTexto(txt)), 'identidade=', JSON.stringify(extrairIdentidadeTexto(txt)));
  console.log('INICIO DO TEXTO:', JSON.stringify(txt.slice(0, 1500)));
}
