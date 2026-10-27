/**
 * Scraper LOJAS SUPERBID (27/10) — 32 sites white-label "Superbid Exchange" da junta. Wrapper fino do motor; fonte em
 * lib/motor/fontes/sbidloja.mjs. API pública (offer-query), custo zero. Só grava a oferta que o portal SUPERBID ainda
 * não trouxe — o resto já está no acervo como `sbid_<id>`.
 * Env: SBIDLOJA_DRYRUN (default '1') · SBIDLOJA_TENANTS (chaves, opcional) · SBIDLOJA_MAX_LOTES (200).
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg, { TENANTS_POR_CHAVE } from './lib/motor/fontes/sbidloja.mjs';
import { tabelaCoberturaSbidLoja } from './lib/motor/fetch-sbidloja.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const filtro = String(process.env.SBIDLOJA_TENANTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const tenants = filtro.length ? filtro.map((k) => TENANTS_POR_CHAVE[k]).filter(Boolean) : cfg.tenants;

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  tenants,
  maxLotes: Number(process.env.SBIDLOJA_MAX_LOTES || 200),
  dryrun: process.env.SBIDLOJA_DRYRUN !== '0',
  semBD: true,
}).then(() => { console.log(`\n── COMPLETUDE LOJAS SUPERBID ──\n${tabelaCoberturaSbidLoja(tenants)}`); })
  .catch((e) => { console.error(e); process.exit(1); });
