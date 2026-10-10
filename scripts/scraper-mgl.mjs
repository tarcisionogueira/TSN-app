/**
 * Scraper MGL — Fernando, Jonas, Lucas Leiloeiro e Viva Leilões (Firecrawl, ~13 créditos/rodada, semanal). Wrapper fino do motor;
 * fonte em lib/motor/fontes/mgl.mjs; parser puro em lib/mgl-parse.mjs.
 *
 * Env: MGL_TENANTS (csv: fernando,jonas,lucas,viva — padrão todos) · MGL_MAX_LOTES (40) · MGL_DRYRUN
 * (default '1') · MGL_DEBUG · FIRECRAWL_API_KEY · FIRECRAWL_MAX_PAGINAS.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/mgl.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const sel = (process.env.MGL_TENANTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const tenants = sel.length ? sel.map((k) => cfg.tenants.find((t) => t.fonte.toLowerCase().startsWith(k))).filter(Boolean) : undefined;

rodarFonte(cfg, {
  tenants,
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.MGL_MAX_LOTES || 40),
  maxPages: 1,
  dryrun: process.env.MGL_DRYRUN !== '0',
  debug: process.env.MGL_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
