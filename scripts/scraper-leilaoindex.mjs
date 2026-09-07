/**
 * Scraper família "leilao/index" — RIGOLONLEILOES, GIORDANOLEILOES, THAISTEIXEIRA (fonte
 * `dom`, custo Bright Data ZERO). Wrapper fino do motor; fonte em
 * lib/motor/fontes/leilaoindex.mjs; parser puro em lib/leilaoindex-parse.mjs.
 *
 * Candidatos achados por cruzamento de edital do DJEN (07/09) — ainda NÃO ligados no cron nem
 * marcados `docs_status='integrado'`: falta validar a paginação real e, pra THAISTEIXEIRA,
 * confirmar que o catálogo enumera algo (o recon isolado veio vazio).
 *
 * Env: LEILAOINDEX_MAX_LOTES (40) · LEILAOINDEX_MAX_PAGES (3) · LEILAOINDEX_DRYRUN (default '1') ·
 * LEILAOINDEX_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/leilaoindex.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.LEILAOINDEX_MAX_LOTES || 40),
  maxPages: Number(process.env.LEILAOINDEX_MAX_PAGES || 3),
  dryrun: process.env.LEILAOINDEX_DRYRUN !== '0',
  debug: process.env.LEILAOINDEX_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
