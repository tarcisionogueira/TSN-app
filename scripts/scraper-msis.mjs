/**
 * Scraper MSIS (26/10) — 21 leiloeiros do RJ na plataforma MSIS. Wrapper fino do motor; fonte em
 * lib/motor/fontes/msis.mjs; parser puro em lib/msis-parse.mjs; transporte em lib/motor/fetch-msis.mjs.
 * Só via grátis (fetch direto do runner + banco/pg_net): nunca Bright Data, nunca Firecrawl.
 *
 * Env: MSIS_MAX_LOTES (200) · MSIS_DRYRUN (default '1') · MSIS_TENANTS (chaves separadas por vírgula, opcional) · MSIS_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 * No fim imprime a TABELA DE COMPLETUDE (o que o site declara × o que foi lido).
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg, { TENANTS_POR_CHAVE } from './lib/motor/fontes/msis.mjs';
import { tabelaCobertura, COBERTURA } from './lib/motor/fetch-msis.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const filtro = String(process.env.MSIS_TENANTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const tenants = filtro.length ? filtro.map((k) => TENANTS_POR_CHAVE[k]).filter(Boolean) : undefined;

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  tenants,
  maxLotes: Number(process.env.MSIS_MAX_LOTES || 200),
  dryrun: process.env.MSIS_DRYRUN !== '0',
  debug: process.env.MSIS_DEBUG === '1',
  semBD: true,
  // Tenant com lote listado mas nenhum aproveitável (todos veículo/COMPREI/sem preço — Le Gentil, Octavio, Pedro
  // Castro em 26/10) já fica em fonte_saude como 'falhou'; não pinta o workflow de vermelho todo dia. O exit 1 é para
  // o que é falha de COLETA: catálogo ou leilão que não abriu (COBERTURA.falhas), checado abaixo.
  exitCodeSeFalha: false,
}).then(() => {
  console.log(`\n── COMPLETUDE MSIS ──\n${tabelaCobertura()}`);
  const falhas = [...COBERTURA].filter(([, c]) => c.falhas.length);
  if (falhas.length) { console.error(`falha de coleta em ${falhas.map(([h]) => h).join(', ')}`); process.exitCode = 1; }
})
  .catch((e) => { console.error(e); try { console.log(tabelaCobertura()); } catch { /* sem tabela */ } process.exit(1); });
