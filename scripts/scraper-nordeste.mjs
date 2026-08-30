/**
 * Scraper NORDESTE — nordesteleiloes.com.br (fonte `dom` do Passo 2, enumeração em 2
 * níveis: home → eventos → lotes; renderiza no runner, custo Bright Data ZERO). Wrapper
 * fino do motor; fonte em lib/motor/fontes/nordeste.mjs; parser em lib/nordeste-parse.mjs.
 *
 * Env: NORDESTE_MAX_LOTES (40) · NORDESTE_MAX_EVENTOS (15) · NORDESTE_DRYRUN (default '1')
 * · NORDESTE_DEBUG. Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/nordeste.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

if (process.env.NORDESTE_MAX_EVENTOS) cfg.maxEventos = Number(process.env.NORDESTE_MAX_EVENTOS);

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.NORDESTE_MAX_LOTES || 40),
  maxPages: 1,
  dryrun: process.env.NORDESTE_DRYRUN !== '0',
  debug: process.env.NORDESTE_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
