/**
 * Scraper LEJE — leje.com.br (fonte `dom`, custo Bright Data ZERO). Wrapper fino do motor;
 * fonte em lib/motor/fontes/leje.mjs; parser puro em lib/leje-parse.mjs.
 *
 * Candidato achado por cruzamento de edital do DJEN (07/09) — ainda NÃO ligado no cron nem
 * marcado `docs_status='integrado'`: falta validar contra rede real.
 *
 * Env: LEJE_MAX_LOTES (40) · LEJE_DRYRUN (default '1') · LEJE_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/leje.mjs';
import { espelharDocsLeje } from './lib/leje-espelho.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const supabase = createClient(SB_URL, SB_KEY);
const dryrun = process.env.LEJE_DRYRUN !== '0';
rodarFonte(cfg, {
  supabase,
  maxLotes: Number(process.env.LEJE_MAX_LOTES || 40),
  maxPages: 1,
  dryrun,
  debug: process.env.LEJE_DEBUG === '1',
}).then(async () => {
  // Documentos (22/10, #284): copiados para o nosso bucket daqui — o site barra o servidor da Vercel.
  // Falha na cópia não falha a coleta (os links já foram gravados).
  if (dryrun) return;
  try { console.log(`  ${await espelharDocsLeje(supabase, { max: Number(process.env.LEJE_DOCS_MAX || 80) })}`); }
  catch (e) { console.log(`  cópia de documentos LEJE falhou: ${String(e?.message || e).slice(0, 120)}`); }
}).catch(e => { console.error(e); process.exit(1); });
