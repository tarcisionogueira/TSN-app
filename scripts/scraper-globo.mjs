/**
 * Scraper GLOBOLEILOES — globoleiloes.com.br (fonte `dom`, custo Bright Data ZERO). Wrapper
 * fino do motor; fonte em lib/motor/fontes/globo.mjs; parser puro em lib/globo-parse.mjs.
 *
 * Candidato achado por cruzamento de edital do DJEN (07/09) — ainda NÃO ligado no cron nem
 * marcado `docs_status='integrado'`: falta validar contra rede real.
 *
 * Env: GLOBO_MAX_LOTES (40) · GLOBO_DRYRUN (default '1') · GLOBO_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/globo.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.GLOBO_MAX_LOTES || 40),
  maxPages: 1,
  dryrun: process.env.GLOBO_DRYRUN !== '0',
  debug: process.env.GLOBO_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
