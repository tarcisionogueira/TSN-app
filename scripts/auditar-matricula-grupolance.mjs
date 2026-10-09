/**
 * AUDITORIA (09/10, #22) — as "matrículas" GRUPOLANCE gravadas como `matricula_grupolance_auto.pdf`
 * são matrícula de verdade? Um dos dois caminhos que gravam esse arquivo (captura-matricula-
 * grupolance.mjs) DEDUZ a URL trocando "edital" por "matricula" no caminho do CDN — pode ter
 * baixado outra coisa. O documental lê esse arquivo como matrícula e o selo tem_matricula_doc
 * fica verde.
 *
 * Baixa cada PDF do Storage (service key), extrai o texto e classifica pelo CONTEÚDO:
 *   matricula — marcas de certidão de registro (Registro de Imóveis + R-n / AV-n / "matrícula nº")
 *   edital    — "edital de leilão/praça" sem marcas de registro
 *   laudo     — laudo/auto de avaliação
 *   sem_texto — PDF escaneado sem camada de texto (não dá para afirmar nada)
 *   outro
 * NÃO GRAVA NADA. Imprime a distribuição e a lista por classe (fonte_id + amostra do texto).
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; AUD_LIMITE (padrão 400).
 */
import { createClient } from '@supabase/supabase-js';
import { carregarPDFParse } from '../api/_pdf-safe.js';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const LIMITE = Number(process.env.AUD_LIMITE || 400);
const PDFParse = await carregarPDFParse();

const { data: anexos, error } = await sb.from('imovel_anexos').select('imovel_id, storage_path, tamanho_kb')
  .like('storage_path', '%matricula_grupolance_auto.pdf').limit(LIMITE);
if (error) { console.error('leitura imovel_anexos:', error.message); process.exit(1); }
const ids = [...new Set(anexos.map((a) => a.imovel_id))];
const lotes = new Map();
for (let i = 0; i < ids.length; i += 200) {
  const { data, error: e2 } = await sb.from('imoveis_leilao').select('id, fonte_id, ativo').in('id', ids.slice(i, i + 200));
  if (e2) { console.error('leitura imoveis_leilao:', e2.message); process.exit(1); }
  for (const l of data) lotes.set(l.id, l);
}

function classificar(t) {
  const x = t.toLowerCase().replace(/\s+/g, ' ');
  if (x.replace(/[^a-zà-ÿ]/g, '').length < 200) return 'sem_texto';
  const registro = /(registro de im[óo]veis|oficial de registro|cart[óo]rio de registro|of[íi]cio de registro|\bcri\b)/.test(x);
  const atos = (x.match(/\b(r|av)[\s.-]*\d{1,3}[\s/.-]*(?:m|mat)?[\s.-]*\d{0,7}\b/g) || []).length;
  const matN = /matr[íi]cula\s*(n[ºo°.]?\s*)?\d/.test(x);
  if (registro && (atos >= 1 || matN)) return 'matricula';
  if (/edital (de )?(leil[ãa]o|pra[çc]a|hasta)/.test(x) || /\bedital\b.{0,80}\bleil[ãa]o\b/.test(x)) return 'edital';
  if (/(laudo|auto) de avalia[çc][ãa]o/.test(x)) return 'laudo';
  if (matN) return 'matricula_fraca';
  return 'outro';
}

const porClasse = {};
let n = 0;
for (const a of anexos) {
  const lote = lotes.get(a.imovel_id);
  let classe = 'erro', amostra = '';
  try {
    const { data: blob, error: e3 } = await sb.storage.from('documentos').download(a.storage_path);
    if (e3 || !blob) throw new Error(e3?.message || 'sem arquivo');
    const buf = Buffer.from(await blob.arrayBuffer());
    const p = new PDFParse({ data: buf });
    let t = '';
    try { t = String((await p.getText()).text || ''); } finally { await p.destroy().catch(() => {}); }
    classe = classificar(t);
    amostra = t.replace(/\s+/g, ' ').trim().slice(0, 160);
  } catch (e) { amostra = String(e?.message || e).slice(0, 120); }
  (porClasse[classe] ||= []).push({ fonte_id: lote?.fonte_id || a.imovel_id, ativo: lote?.ativo, kb: a.tamanho_kb, amostra });
  if (++n % 25 === 0) console.log(`  ${n}/${anexos.length}…`);
}

console.log(`\n═══ ${anexos.length} arquivos matricula_grupolance_auto.pdf ═══`);
for (const [c, l] of Object.entries(porClasse)) console.log(`  ${c.padEnd(16)} ${l.length} (ativos ${l.filter((x) => x.ativo).length})`);
for (const [c, l] of Object.entries(porClasse)) {
  if (c === 'matricula') { console.log(`\n── matricula: 5 amostras`); l.slice(0, 5).forEach((x) => console.log(`   ${x.fonte_id} | ${x.amostra}`)); continue; }
  console.log(`\n── ${c} (${l.length})`);
  l.forEach((x) => console.log(`   ${x.fonte_id}${x.ativo ? '' : ' (inativo)'} ${x.kb}KB | ${x.amostra}`));
}
