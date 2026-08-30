/**
 * Scraper EMILIOMATOS — plataforma Superbid/MBV (white-label SSR). Wrapper FINO do motor
 * (fetch × parse) — fluxo em scripts/lib/motor/runner.mjs; fonte em
 * scripts/lib/motor/fontes/emiliomatos.mjs; parser puro em lib/emiliomatos-parse.mjs. Passo 0
 * do redesenho: comportamento idêntico ao scraper anterior (inclui exit 1 em falha real), só
 * sem a duplicação do runner. NOTA: ganha o guard `fonteVazia` (respondeu com 0 imóveis → sem
 * alarme), que só age no caso de fonte vazia/quebrada — a operação atual (37+ lotes) é a mesma.
 *
 * Env (inalterados): EMILIOMATOS_MAX_LOTES (40) · EMILIOMATOS_MAX_PAGES (15) ·
 *   EMILIOMATOS_DRYRUN (default '1') · EMILIOMATOS_DEBUG ('0') · EMILIOMATOS_NO_BD ('1' força só grátis).
 * Env infra: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/emiliomatos.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.EMILIOMATOS_MAX_LOTES || 40),
  maxPages: Number(process.env.EMILIOMATOS_MAX_PAGES || 15),
  dryrun: process.env.EMILIOMATOS_DRYRUN !== '0',
  debug: process.env.EMILIOMATOS_DEBUG === '1',
  semBD: process.env.EMILIOMATOS_NO_BD === '1',
  exitCodeSeFalha: true,   // o scraper original saía com exit 1 quando não havia o que gravar
}).catch(e => { console.error(e); process.exit(1); });
