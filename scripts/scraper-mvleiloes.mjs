/**
 * Scraper MV LEILÕES (mvleiloes.com.br, 29/10 — fila dos 58 com imóvel e sem leitor, #380). Wrapper fino do motor; fonte
 * em lib/motor/fontes/mvleiloes.mjs; parser puro em lib/mvleiloes-parse.mjs. Só via grátis (`semBD`).
 *
 * Env: MVLEILOES_MAX_LOTES (40) · MVLEILOES_DRYRUN (default '1') · MVLEILOES_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/mvleiloes.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.MVLEILOES_MAX_LOTES || 40),
  dryrun: process.env.MVLEILOES_DRYRUN !== '0',
  debug: process.env.MVLEILOES_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
