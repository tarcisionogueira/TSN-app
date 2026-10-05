// Reclassifica PELO CONTEÚDO os PDFs que o espelho guardou como 'outro'/'anexo' (05/10, resíduo da
// pendência 49). Leiloeiros que publicam tudo como "Documento" deixaram ~2.900 PDFs de lotes ativos
// sem tipo — matrícula e edital guardados sem o selo e o relatório saberem. Lê 2 páginas de cada
// (api/_doc-tipo.js, sem IA). Baixa do NOSSO Storage (não do leiloeiro).
//   CLASSIFICAR_APLICAR=1 grava; sem isso só mostra.  CLASSIFICAR_LIMITE (padrão 80).
// Grava em documento_espelho.tipo e em imovel_anexos.tipo/nome (mesmo storage_path, só se ainda
// genérico). O selo do lote se recalcula na próxima coleta ou pelo SQL do dono.
import { tipoPorConteudoPdf } from '../api/_doc-tipo.js';

const SB = process.env.VITE_SUPABASE_URL; const KEY = process.env.SUPABASE_SERVICE_KEY;
const APLICAR = process.env.CLASSIFICAR_APLICAR === '1';
const LIMITE = Number(process.env.CLASSIFICAR_LIMITE || 80);
const MAX_BYTES = 12 * 1024 * 1024;
if (!SB || !KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(2); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function sb(path, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// Candidatos: copiados genéricos, PDF, até o teto de bytes, de lote ATIVO (via RPC-less: filtro em 2 passos).
const linhas = await sb(`documento_espelho?status=eq.copiado&tipo=in.(outro,anexo)&storage_path=ilike.*.pdf&bytes=lte.${MAX_BYTES}&select=id,storage_path,imovel_id,fonte,bytes&order=id&limit=${Math.max(LIMITE * 4, 400)}`);
const porPath = new Map();
for (const l of linhas) if (!porPath.has(l.storage_path)) porPath.set(l.storage_path, l);
const ids = [...new Set([...porPath.values()].map((l) => l.imovel_id))];
const ativos = new Set();
for (let i = 0; i < ids.length; i += 100) {
  for (const r of await sb(`imoveis_leilao?id=in.(${ids.slice(i, i + 100).join(',')})&ativo=eq.true&select=id`)) ativos.add(r.id);
}
const alvos = [...porPath.values()].filter((l) => ativos.has(l.imovel_id)).slice(0, LIMITE);

const NOME = { matricula: 'Matrícula', edital: 'Edital', laudo: 'Laudo de avaliação' };
const res = { lidos: 0, falhas: 0, porTipo: {}, porFonte: {}, gravados: 0 };
for (const a of alvos) {
  const r = await fetch(`${SB}/storage/v1/object/documentos/${a.storage_path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) { res.falhas++; console.log(`  ✗ ${a.fonte} ${a.storage_path} HTTP ${r.status}`); continue; }
  const { tipo, cabeca } = await tipoPorConteudoPdf(Buffer.from(await r.arrayBuffer()), { comTexto: true });
  res.lidos++;
  const k = tipo || '(indefinido)';
  res.porTipo[k] = (res.porTipo[k] || 0) + 1;
  res.porFonte[a.fonte] ??= {}; res.porFonte[a.fonte][k] = (res.porFonte[a.fonte][k] || 0) + 1;
  console.log(`  ${(tipo || '—').padEnd(9)} ${a.fonte.padEnd(16)} «${cabeca || '(sem texto: escaneado?)'}»`);
  if (!tipo) continue;
  if (!APLICAR) continue;
  await sb(`documento_espelho?storage_path=eq.${encodeURIComponent(a.storage_path)}&tipo=in.(outro,anexo)`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ tipo }) });
  const up = await sb(`imovel_anexos?storage_path=eq.${encodeURIComponent(a.storage_path)}&tipo=in.(outro,anexo)&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ tipo, nome: NOME[tipo] }) });
  res.gravados += up?.length || 0;
}
console.log(`\n${APLICAR ? 'GRAVADO' : 'EM SECO'} — alvos ${alvos.length} · lidos ${res.lidos} · falhas ${res.falhas}${APLICAR ? ` · imovel_anexos atualizados ${res.gravados}` : ''}`);
console.log('por tipo:', JSON.stringify(res.porTipo));
for (const [f, t] of Object.entries(res.porFonte).sort()) console.log(`  ${f.padEnd(18)} ${JSON.stringify(t)}`);
