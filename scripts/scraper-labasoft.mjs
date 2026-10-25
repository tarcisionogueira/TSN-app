/**
 * Scraper PLATAFORMA LABASOFT — Schulmann, Karla Pepe e Leilões Braga (RJ). Fonte `fetch`, custo ZERO (semBD).
 * Wrapper fino do motor; fonte em lib/motor/fontes/labasoft.mjs; parser em lib/labasoft-parse.mjs.
 *
 * Env: LABASOFT_MAX_LOTES (80) · LABASOFT_DRYRUN (default '1') · LABASOFT_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/labasoft.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.LABASOFT_MAX_LOTES || 80),
  maxPages: 1,
  semBD: true,
  dryrun: process.env.LABASOFT_DRYRUN !== '0',
  debug: process.env.LABASOFT_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
