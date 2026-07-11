/**
 * Captura em LOTE das MATRÍCULAS do Grupo Lance — SEM login (matrícula é PÚBLICA no CDN).
 * O edital já é capturado em cdn.grupolance.com.br/.../Grupo_Lance_edital_{id}.pdf; a
 * matrícula fica no MESMO caminho trocando "edital" por "matricula". Este script deriva
 * essa URL, baixa o PDF e sobe no Storage (bucket 'documentos') + imovel_anexos.
 * Roda no GitHub Actions. Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 * Config: GL_MATRICULA_LOTE (default 30).
 */
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'documentos';
const LOTE = Number(process.env.GL_MATRICULA_LOTE || 30);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

async function jaTemMatricula(imovelId) {
  const { data } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').limit(1);
  return !!data?.length;
}

async function salvarMatricula(imovelId, buffer) {
  const path = `casos/${imovelId}/matricula_grupolance_auto.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error('upload: ' + up.error.message);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = signed.data?.signedUrl || null;
  const row = { imovel_id: imovelId, tipo: 'matricula', nome: 'Matrícula do Imóvel', url, storage_path: path, tamanho_kb: Math.round(buffer.length / 1024), role_criador: 'sistema' };
  const { data: existente } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').limit(1);
  if (existente?.length) await supabase.from('imovel_anexos').update(row).eq('id', existente[0].id);
  else await supabase.from('imovel_anexos').insert(row);
  await supabase.from('imoveis_leilao').update({ link_matricula: url }).eq('id', imovelId);
}

// Deriva a URL da matrícula a partir da URL do edital (mesmo CDN/caminho).
function urlMatricula(editalUrl) {
  const base = String(editalUrl || '').split('?')[0];
  if (!/edital/i.test(base)) return null;
  const cand = base.replace(/edital/i, 'matricula');
  return cand !== base ? cand : null;
}

async function main() {
  const { data: lotes, error } = await supabase.from('imoveis_leilao')
    .select('id, anexos')
    .eq('fonte', 'GRUPOLANCE').eq('ativo', true)
    .or('link_matricula.is.null,link_matricula.eq.')
    .not('anexos', 'is', null)
    .limit(LOTE);
  if (error) { console.error('Erro ao ler lotes:', error.message); process.exit(1); }
  if (!lotes?.length) { console.log('Nenhum lote Grupo Lance pendente de matrícula.'); return; }
  console.log(`Grupo Lance: ${lotes.length} lote(s) para tentar matrícula (cap ${LOTE}).`);

  let ok = 0, semMat = 0, erro = 0;
  for (const l of lotes) {
    try {
      if (await jaTemMatricula(l.id)) continue;
      const anexos = Array.isArray(l.anexos) ? l.anexos : [];
      const edital = anexos.find(a => /edital/i.test(a.tipo || a.nome || '') && /\.pdf/i.test(a.url || ''))?.url;
      const matUrl = urlMatricula(edital);
      if (!matUrl) { semMat++; continue; }
      const resp = await fetch(matUrl, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (!resp.ok) { semMat++; console.log(`- ${l.id}: sem matrícula pública (HTTP ${resp.status})`); continue; }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1000 || buf.slice(0, 5).toString('latin1') !== '%PDF-') { erro++; console.log(`- ${l.id}: não é PDF (${buf.length}b)`); continue; }
      await salvarMatricula(l.id, buf);
      ok++; console.log(`✓ ${l.id}: matrícula salva (${Math.round(buf.length / 1024)}kb)`);
      await new Promise(s => setTimeout(s, 400));
    } catch (e) { erro++; console.log(`- ${l.id}: erro ${e.message}`); }
  }
  console.log(`\nGrupo Lance matrícula — resultado: ${ok} salvas · ${semMat} sem matrícula pública · ${erro} erro(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
