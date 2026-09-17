/**
 * Scraper FRANCOLEILOES — francoleiloes.com.br (fonte `dom`, custo Bright Data ZERO). Wrapper
 * fino do motor; fonte em lib/motor/fontes/francoleiloes.mjs; parser puro em
 * lib/francoleiloes-parse.mjs.
 *
 * Candidato achado por cruzamento de edital do DJEN — validado 17/09 (isolarSessao resolve o
 * Cloudflare por sessão; dado real confirmado em produção via dry-run antes de ligar no cron).
 *
 * Env: FRANCOLEILOES_MAX_LOTES (40) · FRANCOLEILOES_DRYRUN (default '1') · FRANCOLEILOES_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/francoleiloes.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.FRANCOLEILOES_MAX_LOTES || 40),
  maxPages: 1,
  dryrun: process.env.FRANCOLEILOES_DRYRUN !== '0',
  debug: process.env.FRANCOLEILOES_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
