/**
 * Scraper ALLIANCE (allianceleiloes.com.br, 28/10 — medição da junta `medicao_2810`). Wrapper fino do motor; fonte em
 * lib/motor/fontes/alliance.mjs; parser puro em lib/alliance-parse.mjs. Só via grátis (`semBD`).
 *
 * Env: ALLIANCE_MAX_LOTES (40) · ALLIANCE_DRYRUN (default '1') · ALLIANCE_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/alliance.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.ALLIANCE_MAX_LOTES || 40),
  dryrun: process.env.ALLIANCE_DRYRUN !== '0',
  debug: process.env.ALLIANCE_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
