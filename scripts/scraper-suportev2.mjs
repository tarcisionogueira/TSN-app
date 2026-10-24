/**
 * Scraper SUPORTE LEILÕES v2 (24/10, pendência 296) — Marco Antônio, Rodrigo Collyer, Anna Luiza e DCM (um banco só,
 * fonte MARCOANTONIO). Wrapper fino do motor; fonte em lib/motor/fontes/suportev2.mjs; parser puro em
 * lib/suportev2-parse.mjs. Só via grátis (`semBD`): fetch direto e, se o runner for barrado, pelo banco.
 *
 * Env: SUPORTEV2_MAX_LOTES (120 — o catálogo inteiro + folga) · SUPORTEV2_DRYRUN (default '1') · SUPORTEV2_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/suportev2.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.SUPORTEV2_MAX_LOTES || 120),
  dryrun: process.env.SUPORTEV2_DRYRUN !== '0',
  debug: process.env.SUPORTEV2_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
