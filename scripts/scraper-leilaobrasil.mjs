/**
 * Scraper LEILAOBRASIL/LUTHERO — leilaobrasil.com.br + lutheroleiloes.com.br, 3º template da
 * infra Suporte Leilões. Fonte `fetch` simples: sem Cloudflare, sem bloqueio de IP, custo
 * Bright Data ZERO (confirmado em 5 rodadas de recon, 19/09). Wrapper fino do motor; fonte em
 * lib/motor/fontes/leilaobrasil.mjs; parser puro em lib/leilaobrasil-parse.mjs.
 *
 * Env: LEILAOBRASIL_MAX_LOTES (default 250 — cobre os ~230 achados no recon + margem),
 * LEILAOBRASIL_DRYRUN (default '1'), LEILAOBRASIL_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/leilaobrasil.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.LEILAOBRASIL_MAX_LOTES || 250),
  dryrun: process.env.LEILAOBRASIL_DRYRUN !== '0',
  debug: process.env.LEILAOBRASIL_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
