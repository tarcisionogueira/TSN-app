/**
 * Limpeza SEGURA do bucket 'documentos' — remove o legado inchado pelo bug do `Date.now()`
 * no caminho (já corrigido em captura-documentos.mjs). Apaga só o que é comprovadamente lixo:
 *   • ÓRFÃOS — objetos sem referência em imovel_anexos / usuario_docs / arrematacoes.
 *   • DUP_EXTRA — cópias IDÊNTICAS (mesmo conteúdo) do MESMO imóvel: mantém 1 (preferindo a
 *     que tem linha em imovel_anexos) e apaga as demais + suas linhas duplicadas.
 * Os candidatos vêm da RPC `storage_limpeza_candidatos()` (SECURITY DEFINER — storage.objects
 * não é exposto pelo PostgREST). Nenhum documento REAL é perdido: de cada conteúdo sobra 1.
 *
 * SEGURANÇA: DRY-RUN por padrão (LIMPAR_DRYRUN != '0') — só LISTA. Rode com LIMPAR_DRYRUN=0
 * p/ apagar. Ordem: apaga a LINHA duplicada primeiro e só então o objeto correspondente
 * (evita linha apontando p/ arquivo inexistente). Roda no GitHub Actions (service key).
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, [LIMPAR_DRYRUN].
 */
import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const DRYRUN = process.env.LIMPAR_DRYRUN !== '0';
const BUCKET = 'documentos';
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const gb = b => (Number(b || 0) / 1073741824).toFixed(2);

async function main() {
  const { data: cands, error } = await sb.rpc('storage_limpeza_candidatos');
  if (error) { console.error('RPC storage_limpeza_candidatos erro:', error.message); process.exit(1); }
  const orfaos = cands.filter(c => c.motivo === 'orfao');
  const dups = cands.filter(c => c.motivo === 'dup_extra');
  const bytes = cands.reduce((s, c) => s + Number(c.bytes || 0), 0);

  console.log(`${DRYRUN ? '🔎 DRY-RUN' : '🧹 EXECUTANDO'} — limpeza do bucket '${BUCKET}'`);
  console.log(`Candidatos: ${cands.length} objetos (~${gb(bytes)}GB) · órfãos ${orfaos.length} · dup_extra ${dups.length}`);
  console.log('Amostra:', JSON.stringify(cands.slice(0, 4).map(c => ({ motivo: c.motivo, path: c.path }))));

  if (DRYRUN) { console.log('\nNada foi apagado. Rode com LIMPAR_DRYRUN=0 para executar.'); return; }

  // 1) Apaga as LINHAS duplicadas primeiro; guarda as que realmente saíram.
  const anexoIds = [...new Set(dups.map(d => d.anexo_id).filter(Boolean))];
  const apagados = new Set();
  for (const lote of chunk(anexoIds, 200)) {
    const { data, error: e } = await sb.from('imovel_anexos').delete().in('id', lote).select('id');
    if (e) { console.error('  delete imovel_anexos erro:', e.message); continue; }
    for (const r of data || []) apagados.add(r.id);
  }
  console.log(`imovel_anexos: ${apagados.size}/${anexoIds.length} linhas duplicadas removidas.`);

  // 2) Remove os objetos: órfãos (sempre) + dup cuja linha confirmadamente saiu.
  const paths = [...new Set([
    ...orfaos.map(o => o.path),
    ...dups.filter(d => !d.anexo_id || apagados.has(d.anexo_id)).map(d => d.path),
  ])];
  let removidos = 0;
  for (const lote of chunk(paths, 100)) {
    const { data, error: e } = await sb.storage.from(BUCKET).remove(lote);
    if (e) { console.error('  storage.remove erro:', e.message); continue; }
    removidos += (data?.length ?? lote.length);
  }
  console.log(`Storage: ${removidos}/${paths.length} objetos removidos (~${gb(bytes)}GB liberados). ✅`);
}

main().catch(e => { console.error(e); process.exit(1); });
