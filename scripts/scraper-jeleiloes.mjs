/**
 * Scraper JELEILOES — jeleiloes.com.br (fonte `dom`, custo Bright Data ZERO). Wrapper fino
 * do motor; fonte em lib/motor/fontes/jeleiloes.mjs; parser puro em lib/jeleiloes-parse.mjs.
 *
 * Candidato achado por cruzamento de edital do DJEN (07/09) — ainda NÃO ligado no cron nem
 * marcado `docs_status='integrado'` em `leiloeiro_conhecimento`: falta validar contra rede
 * real (DRY-RUN aqui foi escrito a partir de recon via GitHub Actions, não de execução do
 * próprio parser contra o HTML ao vivo). Rodar `JELEILOES_DEBUG=1` numa Action antes de virar
 * produção.
 *
 * Env: JELEILOES_MAX_LOTES (40) · JELEILOES_MAX_PAGES (10) · JELEILOES_DRYRUN (default '1') ·
 * JELEILOES_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/jeleiloes.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.JELEILOES_MAX_LOTES || 40),
  maxPages: Number(process.env.JELEILOES_MAX_PAGES || 10),
  dryrun: process.env.JELEILOES_DRYRUN !== '0',
  debug: process.env.JELEILOES_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
