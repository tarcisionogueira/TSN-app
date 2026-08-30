/**
 * Scraper LEILAOPRO — plataforma "LeilãoPro Core" (leffa/oscar). Wrapper FINO do motor
 * (fetch × parse) — o fluxo vive em scripts/lib/motor/runner.mjs; a fonte é declarada em
 * scripts/lib/motor/fontes/leilaopro.mjs; o parser puro em lib/leilaopro-parse.mjs. Passo 0
 * do redesenho: comportamento idêntico ao scraper anterior, só sem a duplicação do runner.
 *
 * Env (inalterados): LEILAOPRO_TENANTS ('leffa,oscar') · LEILAOPRO_MAX_LOTES (40) ·
 *   LEILAOPRO_MAX_PAGES (3) · LEILAOPRO_DRYRUN (default '1') · LEILAOPRO_DEBUG ('0').
 * Env infra: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg, { TENANTS_POR_CHAVE } from './lib/motor/fontes/leilaopro.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const chaves = (process.env.LEILAOPRO_TENANTS || 'leffa,oscar').split(',').map(s => s.trim()).filter(Boolean);
const tenants = chaves.map(k => TENANTS_POR_CHAVE[k]).filter(Boolean);
if (chaves.length && !tenants.length) { console.error('LEILAOPRO_TENANTS não casou com nenhum tenant conhecido.'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  tenants,
  maxLotes: Number(process.env.LEILAOPRO_MAX_LOTES || 40),
  maxPages: Number(process.env.LEILAOPRO_MAX_PAGES || 3),
  dryrun: process.env.LEILAOPRO_DRYRUN !== '0',
  debug: process.env.LEILAOPRO_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
