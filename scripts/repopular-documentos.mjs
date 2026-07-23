/**
 * RECUPERAÇÃO de documentos após perda de storage (catástrofe) — sem backup dos arquivos.
 * ────────────────────────────────────────────────────────────────────────────
 * O banco (Postgres) já tem backup automático do Supabase (diário, 7 dias), então os
 * REGISTROS de imóveis/anexos sobrevivem. Este script RE-ENFILEIRA os imóveis ATIVOS cujos
 * anexos apontam p/ arquivos que sumiram do storage → o cron `captura-documentos` re-baixa
 * os PDFs das FONTES originais (link_edital/link_matricula/anexos de imoveis_leilao) e repõe.
 * Recupera tudo que ainda está VIVO na origem (leilão ativo). Docs de leilões já encerrados
 * ou uploads humanos NÃO voltam por aqui — esses ficam no espelho (espelhar-docs-criticos.mjs).
 *
 * Usa a RPC imoveis_docs_faltando() (SECURITY DEFINER — lê storage.objects). Em perda TOTAL,
 * ela devolve todos os imóveis ativos com anexos.
 *
 * SEGURANÇA: DRY-RUN por padrão (REPOPULAR_DRYRUN != '0') — só conta. REPOPULAR_DRYRUN=0
 * enfileira. REPOPULAR_TODOS=1 força TODOS os imóveis ativos com anexos (re-verificação
 * completa), não só os quebrados. Depois de enfileirar, rode o workflow de captura de docs.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, [REPOPULAR_DRYRUN], [REPOPULAR_TODOS].
 */
import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const DRYRUN = process.env.REPOPULAR_DRYRUN !== '0';
const TODOS = process.env.REPOPULAR_TODOS === '1';
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function alvos() {
  if (TODOS) {
    // Todos os imóveis ATIVOS que têm ao menos 1 anexo registrado.
    const ids = new Set();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('imovel_anexos')
        .select('imovel_id, imoveis_leilao!inner(ativo)')
        .eq('imoveis_leilao.ativo', true).range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data) ids.add(r.imovel_id);
      if (data.length < 1000) break;
    }
    return [...ids];
  }
  const { data, error } = await sb.rpc('imoveis_docs_faltando');
  if (error) throw new Error('RPC imoveis_docs_faltando: ' + error.message);
  return (data || []).map(r => r.imovel_id);
}

async function main() {
  const ids = await alvos();
  console.log(`${DRYRUN ? '🔎 DRY-RUN' : '♻️  REPOPULANDO'} — modo: ${TODOS ? 'TODOS ativos c/ anexo' : 'só com storage faltando'}`);
  console.log(`Imóveis a re-enfileirar: ${ids.length}`);
  if (!ids.length) { console.log('Nada a repor — storage íntegro.'); return; }
  console.log('Amostra:', JSON.stringify(ids.slice(0, 5)));

  if (DRYRUN) { console.log('\nDRY-RUN — nada enfileirado. Rode com REPOPULAR_DRYRUN=0.'); return; }

  let n = 0;
  for (const lote of chunk(ids, 500)) {
    const rows = lote.map(imovel_id => ({ imovel_id, status: 'pendente', tentativas: 0, erro: null }));
    const { error } = await sb.from('documentos_fila').upsert(rows, { onConflict: 'imovel_id' });
    if (error) { console.error('  upsert fila erro:', error.message); continue; }
    n += lote.length;
  }
  console.log(`✅ ${n} imóvel(is) enfileirado(s) (status=pendente). Agora rode o workflow "captura-documentos" p/ re-baixar os PDFs das fontes.`);
}

main().catch(e => { console.error(e); process.exit(1); });
