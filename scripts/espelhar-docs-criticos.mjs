/**
 * ESPELHO dos documentos INSUBSTITUÍVEIS — os poucos que a re-captura NÃO recupera:
 *   • uploads HUMANOS (imovel_anexos.role_criador <> 'sistema') — laudos/editais que a
 *     pessoa subiu à mão, sem fonte na web p/ re-baixar;
 *   • COMPROVANTES de pagamento (bucket documentos, prefixo 'comprovantes/').
 * Baixa cada um do Storage para uma pasta local; o workflow guarda essa pasta como ARTEFATO
 * do GitHub Actions (fora do Supabase, retenção 90 dias) → cópia de catástrofe sem infra nova.
 * (Os ~7,7 mil docs do scraper NÃO entram aqui — esses voltam pela re-captura.)
 *
 * Escala barato: o conjunto insubstituível é pequeno (dezenas de arquivos). Se crescer muito,
 * migrar p/ R2/S3. Idempotente e read-only no banco.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, [BACKUP_DIR=backup-criticos].
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const OUT = process.env.BACKUP_DIR || 'backup-criticos';
const BUCKET = 'documentos';
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);

async function baixar(path) {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) { console.log(`  ✗ ${path}: ${error?.message || 'sem dados'}`); return 0; }
  const buf = Buffer.from(await data.arrayBuffer());
  const dest = `${OUT}/${path}`;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  console.log(`🗄️  Espelho de documentos insubstituíveis → ./${OUT}/`);

  // 1) Uploads humanos (não-sistema).
  const { data: humanos, error: eH } = await sb.from('imovel_anexos')
    .select('storage_path, nome, tipo').neq('role_criador', 'sistema');
  if (eH) console.error('erro imovel_anexos:', eH.message);

  // 2) Comprovantes de pagamento (prefixo comprovantes/).
  const comps = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.storage.from(BUCKET).list('comprovantes', { limit: 1000, offset: off });
    if (!data?.length) break;
    for (const o of data) if (o.name) comps.push(`comprovantes/${o.name}`);
    if (data.length < 1000) break;
  }

  const paths = [...new Set([
    ...(humanos || []).map(h => h.storage_path).filter(Boolean),
    ...comps,
  ])];
  console.log(`Insubstituíveis: ${paths.length} (${(humanos || []).length} uploads humanos + ${comps.length} comprovantes).`);

  let ok = 0, bytes = 0;
  for (const p of paths) { const n = await baixar(p); if (n) { ok++; bytes += n; } }

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
    gerado_em: new Date().toISOString(),
    total: paths.length, baixados: ok, bytes,
    uploads_humanos: (humanos || []).map(h => ({ storage_path: h.storage_path, nome: h.nome, tipo: h.tipo })),
    comprovantes: comps,
  }, null, 2));
  console.log(`✅ ${ok}/${paths.length} arquivos espelhados (~${(bytes / 1048576).toFixed(1)}MB) + manifest.json.`);
}

main().catch(e => { console.error(e); process.exit(1); });
