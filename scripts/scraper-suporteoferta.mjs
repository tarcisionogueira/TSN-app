/**
 * Scraper Suporte "oferta" — Rafael Leiloeiro + (24/10, Juntas) Portella, Fabiano Ayupp, De Paula e Leilões JA (RJ)
 * (fetch grátis). Wrapper fino do motor;
 * fonte em lib/motor/fontes/suporteoferta.mjs; parser puro em lib/suporte-oferta-parse.mjs.
 *
 * Env: SUPORTEOFERTA_MAX_LOTES (40) · SUPORTEOFERTA_DRYRUN (default '1') · SUPORTEOFERTA_DEBUG.
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import cfg from './lib/motor/fontes/suporteoferta.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

rodarFonte(cfg, {
  supabase: createClient(SB_URL, SB_KEY),
  // 30/10: 40 → 200. O DH lista ~122 lotes "Aberto para propostas" SEM preço (R$0,00, prazo 13/01/2027) ANTES dos
  // "Aberto para lances", e a busca não tem filtro de status; com 40 novos/rodada (1 rodada/dia) o coletor levava ~4
  // dias para chegar a um lote com lance. Fetch grátis (~2 s/lote); os sem preço vão para a memória de recusa (#238)
  // e não voltam à fila por 30 dias.
  maxLotes: Number(process.env.SUPORTEOFERTA_MAX_LOTES || 200),
  // 30/10: era `maxPages: 3` fixo, por cima do `maxPages` da config — o DH (11 páginas, encerrados nas 3 primeiras e
  // os ~155 abertos da 4ª em diante) enumerava 60, todos encerrados, e gravava 0 com o site cheio. Agora vale a config
  // (fetch grátis; o laço para na 1ª página sem lote novo), com teto por env para teste.
  maxPages: Number(process.env.SUPORTEOFERTA_MAX_PAGES) || cfg.maxPages,
  // 24/10: só via grátis (direto e, se o runner for barrado, pelo banco) — nenhum dos cinco tem Cloudflare challenge,
  // e tenant novo não pode abrir gasto de Web Unlocker (regra do dono de 22/10: nada de custo novo).
  semBD: true,
  dryrun: process.env.SUPORTEOFERTA_DRYRUN !== '0',
  debug: process.env.SUPORTEOFERTA_DEBUG === '1',
}).catch(e => { console.error(e); process.exit(1); });
