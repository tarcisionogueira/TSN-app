/**
 * Scraper FREITAS LEILOEIRO — freitasleiloeiro.com.br (imóveis). Wrapper fino do motor; fonte em
 * lib/motor/fontes/freitas.mjs; parser puro em lib/freitas-parse.mjs (teste:
 * scripts/testes/freitas-parse.mjs, trechos reais do recon de 27/09).
 *
 * Env: FREITAS_MAX_LOTES (40) · FREITAS_DRYRUN (default '1') · FREITAS_DEBUG ·
 *      FREITAS_BD ('1' libera o Bright Data se a via grátis falhar — default: só grátis).
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/freitas.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.FREITAS_MAX_LOTES || 40),
  maxPages: 1,
  dryrun: process.env.FREITAS_DRYRUN !== '0',
  debug: process.env.FREITAS_DEBUG === '1',
  semBD: process.env.FREITAS_BD !== '1',
}).catch(e => { console.error(e); process.exit(1); });
