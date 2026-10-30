/**
 * Scraper PAULO BOTELHO (paulobotelholeiloeiro.com.br, 30/10 — fila #380). Wrapper
 * fino do motor; fonte em lib/motor/fontes/botelho.mjs; parser puro em lib/botelho-parse.mjs. Só via
 * grátis (`semBD`).
 *
 * Env: BOTELHO_MAX_LOTES (80) · BOTELHO_DRYRUN (default '1') · BOTELHO_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/botelho.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.BOTELHO_MAX_LOTES || 80),
  dryrun: process.env.BOTELHO_DRYRUN !== '0',
  debug: process.env.BOTELHO_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
