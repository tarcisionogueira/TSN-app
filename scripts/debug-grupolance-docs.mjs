/**
 * RECON (sem login) — Grupo Lance: a matrícula é PÚBLICA (CDN) ou login-gated?
 * O edital já é capturado num CDN público (cdn.grupolance.com.br/.../Grupo_Lance_edital_{id}.pdf).
 * Testa: (1) o padrão do CDN trocando "edital" por "matricula"; (2) a página do lote
 * atrás de qualquer link .pdf de matrícula. Roda no GitHub Actions (egress aberto).
 * Não grava nada — só diagnostica. Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const N = Number(process.env.GL_DEBUG_N || 10);

async function status(url, method = 'GET') {
  try {
    const r = await fetch(url, { method, headers: { 'User-Agent': UA, Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return r.status;
  } catch (e) { return `ERR(${e.message})`; }
}

const { data: lotes, error } = await supabase.from('imoveis_leilao')
  .select('id, url_lote, anexos')
  .eq('fonte', 'GRUPOLANCE').eq('ativo', true)
  .not('anexos', 'is', null).limit(N);
if (error) { console.error(error.message); process.exit(1); }

let publica = 0, gated = 0;
for (const l of lotes || []) {
  const anexos = Array.isArray(l.anexos) ? l.anexos : [];
  const edital = anexos.find(a => /edital/i.test(a.tipo || a.nome || '') && /\.pdf/i.test(a.url || ''))?.url;
  let achou = null;

  // (1) padrão do CDN: troca "edital" por variações de "matricula"
  if (edital) {
    const base = edital.split('?')[0];
    for (const t of ['matricula', 'matriculas', 'matricula-imovel', 'Matricula', 'matrícula']) {
      const cand = base.replace(/edital/i, t);
      if (cand === base) continue;
      const s = await status(cand);
      console.log(`  ${l.id} CDN ${t} -> ${s}`);
      if (s === 200 || s === 206) { achou = cand; break; }
    }
  }

  // (2) página do lote: procura QUALQUER link .pdf com "matricul"
  if (!achou && l.url_lote) {
    try {
      const r = await fetch(l.url_lote, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(25000) });
      const html = await r.text();
      const pdfs = [...html.matchAll(/https?:\/\/[^"'\s)]+matr[ií]cul[^"'\s)]*\.pdf[^"'\s)]*/gi)].map(m => m[0]);
      const temLogin = /minha-conta|fazer login|\/login|name="_token"|senha|password/i.test(html);
      console.log(`  ${l.id} page=${r.status} pdfs_matricula=${pdfs.length} loginNaPagina=${temLogin} ${pdfs.slice(0, 1).join('')}`);
      if (pdfs.length) achou = pdfs[0];
    } catch (e) { console.log(`  ${l.id} page ERR ${e.message}`); }
  }

  if (achou) { publica++; console.log(`✓ ${l.id}: matrícula PÚBLICA -> ${achou.slice(0, 130)}`); }
  else { gated++; console.log(`✗ ${l.id}: matrícula não achada publicamente`); }
}
console.log(`\nGL recon: ${publica} pública(s) · ${gated} não-achada(s) de ${(lotes || []).length}.`);
console.log(publica > 0 ? '=> Matrícula parece PÚBLICA: dá para capturar sem login (ajustar seletor/CDN).'
  : '=> Nenhuma matrícula pública encontrada: provavelmente login-gated (usar molde ZUK + credenciais).');
