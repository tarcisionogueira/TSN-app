/**
 * Scraper KLÖCKNER LEILÕES (kleiloes.com.br; pendência 468, 11/11). Wrapper fino do motor; fonte em
 * lib/motor/fontes/kleiloes.mjs; parser puro em lib/kleiloes-parse.mjs. Só via grátis (`semBD`).
 * Os veículos saem pelo scraper-veiculos-motor.mjs (chave `kleiloes`).
 *
 * Env: KLEILOES_MAX_LOTES (80) · KLEILOES_DRYRUN (default '1') · KLEILOES_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/kleiloes.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.KLEILOES_MAX_LOTES || 80),
  dryrun: process.env.KLEILOES_DRYRUN !== '0',
  debug: process.env.KLEILOES_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
