/**
 * Scraper EXTERNO — plataforma Leiloar /externo/ (Sanches, Osvaldo, Judhastas):
 * leilão = imóvel, valores do edital em PDF. Sem Bright Data (semBD). Wrapper fino do motor; fonte em
 * lib/motor/fontes/externo.mjs; parser puro em lib/externo-parse.mjs.
 *
 * Env: EXTERNO_MAX_LOTES (default 60), EXTERNO_DRYRUN (default '1'), EXTERNO_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/externo.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.EXTERNO_MAX_LOTES || 60),
  dryrun: process.env.EXTERNO_DRYRUN !== '0',
  debug: process.env.EXTERNO_DEBUG === '1',
  semBD: true, // ~15 imóveis: nunca vale crédito pago; Cloudflare do osvaldo passa pelo banco
}).catch(e => { console.error(e); process.exit(1); });
