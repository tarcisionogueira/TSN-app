/**
 * Scraper LEILÃO ELETRÔNICO (23/10, pendência 307). Wrapper fino do motor; fonte em
 * lib/motor/fontes/leilaoeletronico.mjs; parser puro em lib/leilaoeletronico-parse.mjs. Só via grátis (`semBD`).
 *
 * Env: LEILAOELETRONICO_MAX_LOTES (250 — o catálogo inteiro; a releitura tem teto próprio na fonte) · LEILAOELETRONICO_DRYRUN (default '1') · LEILAOELETRONICO_DEBUG
 * · LEILAOELETRONICO_TENANTS (csv de chaves de TENANTS em lib/leilaoeletronico-parse.mjs — leilaoeletronico,destak,taba,
 *   oficial,silva,pulse,silveira,milhao,up,select; padrão: todos). 24/10: a mesma plataforma Degrau em mais 9 leiloeiros.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg, { TENANTS_POR_CHAVE } from './lib/motor/fontes/leilaoeletronico.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

// Chave desconhecida PARA a execução (não some calada): erro de digitação no workflow viraria "rodou 0 tenants, ok".
const sel = (process.env.LEILAOELETRONICO_TENANTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const desconhecidas = sel.filter((k) => !TENANTS_POR_CHAVE[k]);
if (desconhecidas.length) { console.error(`LEILAOELETRONICO_TENANTS desconhecido: ${desconhecidas.join(',')} (conhecidos: ${Object.keys(TENANTS_POR_CHAVE).join(',')})`); process.exit(1); }
const tenants = sel.length ? sel.map((k) => TENANTS_POR_CHAVE[k]) : undefined;

rodarFonte(cfg, {
  tenants,
  supabase: createClient(SB_URL, SB_KEY),
  maxLotes: Number(process.env.LEILAOELETRONICO_MAX_LOTES || 250),
  dryrun: process.env.LEILAOELETRONICO_DRYRUN !== '0',
  debug: process.env.LEILAOELETRONICO_DEBUG === '1',
  semBD: true,
  exitCodeSeFalha: true,
}).catch(e => { console.error(e); process.exit(1); });
