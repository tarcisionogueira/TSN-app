/**
 * Scraper HASTA — hastaleiloes.com.br, o site REAL (plural; ver a história do domínio
 * errado em lib/hasta-parse.mjs). Fonte `dom`: bloqueia datacenter, roda no runner
 * RESIDENCIAL — custo Bright Data ZERO. Wrapper fino do motor; fonte em
 * lib/motor/fontes/hasta.mjs; parser puro em lib/hasta-parse.mjs.
 *
 * Acervo real (CSV do dono, 21/08): 579 lotes em ~20 páginas de 30 — por isso o default
 * de HASTA_MAX_PAGES é 20 (o motor para sozinho quando uma página não traz nada novo).
 *
 * MAX_LOTES = 600 (acervo 579 + margem). O `runner-residencial.sh` já passava 600 na linha
 * dele; o default aqui era 40, então a rodada NA MÃO media outra coisa que a agendada — e foi
 * assim que o teto pareceu ser o problema no recon de 29/08 quando não era. Um default que não
 * bate com o uso real é uma armadilha para quem for depurar.
 * Custo de subir: só TEMPO. A HASTA é `dom` (Chromium residencial) e nunca toca Bright Data.
 *
 * Env: HASTA_MAX_LOTES (600) · HASTA_MAX_PAGES (20) · HASTA_DRYRUN (default '1') · HASTA_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/hasta.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.HASTA_MAX_LOTES || 600),
  maxPages: Number(process.env.HASTA_MAX_PAGES || 20),
  dryrun: process.env.HASTA_DRYRUN !== '0',
  debug: process.env.HASTA_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
