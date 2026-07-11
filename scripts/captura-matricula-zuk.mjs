/**
 * Captura em LOTE das MATRÍCULAS do Portal Zuk (login-gated) — roda no GitHub Actions.
 * O edital do Zuk é público (já vem no scrape); a MATRÍCULA fica atrás de login.
 * Este script loga UMA vez (ZUK_EMAIL/ZUK_SENHA), pega a URL ASSINADA da matrícula de
 * cada lote ZUK ainda sem matrícula, BAIXA o PDF e sobe no Storage (bucket 'documentos')
 * + registra em `imovel_anexos` (tipo=matricula). Guardamos o ARQUIVO (não a URL, que
 * expira). O Vercel segue como fallback on-demand (api/_zuk-auth.js).
 *
 * Secrets necessários: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, ZUK_EMAIL, ZUK_SENHA.
 * Config opcional: ZUK_MATRICULA_LOTE (quantos lotes por rodada, default 20).
 */
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';
import { loginZuk, matriculaLoteLogado } from '../api/_zuk-auth.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'documentos';
const LOTE = Number(process.env.ZUK_MATRICULA_LOTE || 20);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

async function jaTemMatricula(imovelId) {
  const { data } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').limit(1);
  return !!data?.length;
}

async function salvarMatricula(imovelId, buffer) {
  const path = `casos/${imovelId}/matricula_zuk_auto.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error('upload: ' + up.error.message);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = signed.data?.signedUrl || null;
  const row = { imovel_id: imovelId, tipo: 'matricula', nome: 'Matrícula do Imóvel', url, storage_path: path, tamanho_kb: Math.round(buffer.length / 1024), role_criador: 'sistema' };
  const { data: existente } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').limit(1);
  if (existente?.length) await supabase.from('imovel_anexos').update(row).eq('id', existente[0].id);
  else await supabase.from('imovel_anexos').insert(row);
  // Aponta o link do imóvel para o ARQUIVO guardado (não a URL assinada do Zuk, que expira).
  await supabase.from('imoveis_leilao').update({ link_matricula: url }).eq('id', imovelId);
}

async function main() {
  if (!process.env.ZUK_EMAIL || !process.env.ZUK_SENHA) { console.error('ZUK_EMAIL/ZUK_SENHA ausentes'); process.exit(1); }

  // Lotes ZUK ativos ainda SEM matrícula (usa link_edital como URL do lote no Zuk).
  const { data: lotes, error } = await supabase.from('imoveis_leilao')
    .select('id, link_edital')
    .eq('fonte', 'ZUK').eq('ativo', true)
    .or('link_matricula.is.null,link_matricula.eq.')
    .not('link_edital', 'is', null)
    .limit(LOTE);
  if (error) { console.error('Erro ao ler lotes:', error.message); process.exit(1); }
  if (!lotes?.length) { console.log('Nenhum lote ZUK pendente de matrícula.'); return; }
  console.log(`ZUK: ${lotes.length} lote(s) para tentar matrícula (cap ${LOTE}).`);

  const jar = await loginZuk(lotes[0].link_edital);
  if (!jar) { console.error('Falha no login do Zuk — abortando (confira ZUK_EMAIL/ZUK_SENHA).'); process.exit(1); }

  let ok = 0, semMat = 0, erro = 0;
  for (const lote of lotes) {
    try {
      if (await jaTemMatricula(lote.id)) continue;
      const r = await matriculaLoteLogado(lote.link_edital, jar);
      if (!r?.matricula) { semMat++; console.log(`- ${lote.id}: sem matrícula (cards=${r?.cards ?? '?'})`); continue; }
      const resp = await fetch(r.matricula, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!resp.ok) { erro++; console.log(`- ${lote.id}: download HTTP ${resp.status}`); continue; }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1000 || buf.slice(0, 5).toString('latin1') !== '%PDF-') { erro++; console.log(`- ${lote.id}: não é PDF (${buf.length}b)`); continue; }
      await salvarMatricula(lote.id, buf);
      ok++; console.log(`✓ ${lote.id}: matrícula salva (${Math.round(buf.length / 1024)}kb) ${/Signature=/i.test(r.matricula) ? '[assinada]' : ''}`);
      await new Promise(s => setTimeout(s, 800)); // gentil com o site
    } catch (e) { erro++; console.log(`- ${lote.id}: erro ${e.message}`); }
  }
  console.log(`\nZUK matrícula — resultado: ${ok} salvas · ${semMat} sem matrícula · ${erro} erro(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
