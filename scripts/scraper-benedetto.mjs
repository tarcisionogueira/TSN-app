/**
 * Scraper BENEDETTO LEILÕES (benedettoleiloes.com.br, 30/10 — fila #380). Wrapper
 * fino do motor; fonte em lib/motor/fontes/benedetto.mjs; parser puro em lib/benedetto-parse.mjs. Só via
 * grátis (`semBD`).
 *
 * Env: BENEDETTO_MAX_LOTES (80) · BENEDETTO_DRYRUN (default '1') · BENEDETTO_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/benedetto.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.BENEDETTO_MAX_LOTES || 80),
  dryrun: process.env.BENEDETTO_DRYRUN !== '0',
  debug: process.env.BENEDETTO_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
