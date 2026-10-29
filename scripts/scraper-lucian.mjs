/**
 * Scraper LUCIAN (lucianleiloes.com.br, 28/10 — medição da junta `medicao_2810`). Wrapper fino do motor; fonte em
 * lib/motor/fontes/lucian.mjs; parser puro em lib/lucian-parse.mjs. Só via grátis (`semBD`).
 *
 * Env: LUCIAN_MAX_LOTES (60) · LUCIAN_DRYRUN (default '1') · LUCIAN_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/lucian.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.LUCIAN_MAX_LOTES || 60),
  dryrun: process.env.LUCIAN_DRYRUN !== '0',
  debug: process.env.LUCIAN_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
