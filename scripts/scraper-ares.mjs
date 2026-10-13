/**
 * Scraper ARES — plataforma Ares (Picelli + Shiokawa), white-label sobre
 * Supabase. API PostgREST pública, custo Bright Data ZERO. Wrapper fino do motor; fonte em
 * lib/motor/fontes/ares.mjs; parser puro em lib/ares-parse.mjs.
 *
 * Env: ARES_MAX_LOTES (default 150), ARES_DRYRUN (default '1'), ARES_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/ares.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.ARES_MAX_LOTES || 150),
  dryrun: process.env.ARES_DRYRUN !== '0',
  debug: process.env.ARES_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
