/**
 * Scraper LEILÕESBR (27/10) — 44 leiloeiros da plataforma LeilõesBR (arte/antiguidades). Wrapper fino do motor; fonte
 * em lib/motor/fontes/leiloesbr.mjs. Só via grátis (fetch do runner do GitHub): nunca Bright Data, nunca Firecrawl.
 * Env: LEILOESBR_DRYRUN (default '1') · LEILOESBR_TENANTS (chaves, opcional) · LEILOESBR_MAX_LOTES (50).
 * No fim imprime a TABELA DE COMPLETUDE (peças que cada catálogo declara × peças com tipo; candidatos a imóvel/veículo).
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg, { TENANTS_POR_CHAVE } from './lib/motor/fontes/leiloesbr.mjs';
import { tabelaCoberturaLeiloesBr } from './lib/leiloesbr-parse.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const filtro = String(process.env.LEILOESBR_TENANTS || '').split(',').map((s) => s.trim()).filter(Boolean);

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  tenants: filtro.length ? filtro.map((k) => TENANTS_POR_CHAVE[k]).filter(Boolean) : undefined,
  maxLotes: Number(process.env.LEILOESBR_MAX_LOTES || 50),
  dryrun: process.env.LEILOESBR_DRYRUN !== '0',
  semBD: true,
}).then(() => { console.log(`\n── COMPLETUDE LEILÕESBR ──\n${tabelaCoberturaLeiloesBr()}`); })
  .catch((e) => { console.error(e); process.exit(1); });
