/**
 * Scraper D1 LANCE (d1lance.com.br, 30/10). Wrapper
 * fino do motor; fonte em lib/motor/fontes/d1lance.mjs; parser puro em lib/d1lance-parse.mjs. Só via
 * grátis (`semBD`).
 *
 * Env: D1LANCE_MAX_LOTES (130) · D1LANCE_DRYRUN (default '1') · D1LANCE_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/d1lance.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.D1LANCE_MAX_LOTES || 130),
  dryrun: process.env.D1LANCE_DRYRUN !== '0',
  debug: process.env.D1LANCE_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
