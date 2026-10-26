/**
 * Scraper ROISOFT (26/10) — 7 leiloeiros na plataforma Roisoft. Wrapper fino do motor; fonte em
 * lib/motor/fontes/roisoft.mjs. Só via grátis (fetch do runner do GitHub): nunca Bright Data, nunca Firecrawl.
 * Env: ROISOFT_MAX_LOTES (200) · ROISOFT_DRYRUN (default '1') · ROISOFT_TENANTS (chaves, opcional).
 * No fim imprime a TABELA DE COMPLETUDE ("total" que o site declara × lotes enumerados).
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg, { TENANTS_POR_CHAVE } from './lib/motor/fontes/roisoft.mjs';
import { tabelaCoberturaRoisoft } from './lib/motor/fetch-roisoft.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const filtro = String(process.env.ROISOFT_TENANTS || '').split(',').map((s) => s.trim()).filter(Boolean);

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  tenants: filtro.length ? filtro.map((k) => TENANTS_POR_CHAVE[k]).filter(Boolean) : undefined,
  maxLotes: Number(process.env.ROISOFT_MAX_LOTES || 200),
  dryrun: process.env.ROISOFT_DRYRUN !== '0',
  semBD: true,
  exitCodeSeFalha: true,
}).then(() => { console.log(`\n── COMPLETUDE ROISOFT ──\n${tabelaCoberturaRoisoft()}`); })
  .catch((e) => { console.error(e); process.exit(1); });
