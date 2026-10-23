/**
 * Scraper LEILÃO ELETRÔNICO (23/10, pendência 307). Wrapper fino do motor; fonte em
 * lib/motor/fontes/leilaoeletronico.mjs; parser puro em lib/leilaoeletronico-parse.mjs. Só via grátis (`semBD`).
 *
 * Env: LEILAOELETRONICO_MAX_LOTES (80) · LEILAOELETRONICO_DRYRUN (default '1') · LEILAOELETRONICO_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/leilaoeletronico.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.LEILAOELETRONICO_MAX_LOTES || 80),
  dryrun: process.env.LEILAOELETRONICO_DRYRUN !== '0',
  debug: process.env.LEILAOELETRONICO_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
