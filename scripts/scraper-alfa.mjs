/**
 * Scraper ALFA — alfaleiloes.com.br (fonte `dom` do Passo 2: SPA renderizada no runner,
 * custo Bright Data ZERO). Wrapper fino do motor; fonte em lib/motor/fontes/alfaleiloes.mjs;
 * parser puro em lib/alfa-parse.mjs.
 *
 * Env: ALFA_MAX_LOTES (40) · ALFA_MAX_PAGES (2) · ALFA_DRYRUN (default '1') · ALFA_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/alfaleiloes.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.ALFA_MAX_LOTES || 40),
  maxPages: Number(process.env.ALFA_MAX_PAGES || 2),
  dryrun: process.env.ALFA_DRYRUN !== '0',
  debug: process.env.ALFA_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
