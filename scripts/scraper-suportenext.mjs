/**
 * Scraper dos fronts NOVOS da Suporte Leilões que nenhum coletor lia (26/10, pedido do dono: ligar mesmo com catálogo
 * vazio). Wrapper fino do motor, uma config por front, UMA FONTE POR SITE — o motor varre sumidos por `fonte`, então
 * tenant com erro, cortado ou vazio só mexe no próprio acervo (e nem nele: catálogo que não abre, ou lista
 * cortada, não aposenta nada):
 *   lancevip         → LANCEVIP          (lib/motor/fontes/lancevip.mjs)
 *   vixleiloes       → VIXLEILOES        (lib/motor/fontes/vixleiloes.mjs)
 *   portaldosleiloes → PORTALDOSLEILOES  (lib/motor/fontes/portaldosleiloes.mjs)
 *   suporteclassico  → SIMOESLEILOES, VJLEILOES, MARCOLEILOES (lib/motor/fontes/suporteclassico.mjs)
 * Só via grátis (`semBD`): fetch direto e, se o runner for barrado, pelo banco. Nunca Bright Data nem Firecrawl.
 *
 * Env: SUPORTENEXT_FONTES (csv das chaves acima; vazio = todas) · SUPORTENEXT_MAX_LOTES (120) ·
 *      SUPORTENEXT_DRYRUN (default '1') · SUPORTENEXT_DEBUG. Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { rodarFonte } from './lib/motor/runner.mjs';
import lancevip from './lib/motor/fontes/lancevip.mjs';
import vixleiloes from './lib/motor/fontes/vixleiloes.mjs';
import portaldosleiloes from './lib/motor/fontes/portaldosleiloes.mjs';
import suporteclassico from './lib/motor/fontes/suporteclassico.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const TODAS = [lancevip, vixleiloes, portaldosleiloes, suporteclassico];
const PEDIDAS = String(process.env.SUPORTENEXT_FONTES || '').split(',').map((s) => s.trim()).filter(Boolean);
const fontes = PEDIDAS.length ? TODAS.filter((c) => PEDIDAS.includes(c.chave)) : TODAS;
if (!fontes.length) { console.error(`nenhuma fonte para: ${PEDIDAS.join(',')}`); process.exit(1); }

const supabase = createClient(SB_URL, SB_KEY);
// Uma fonte que quebra (exceção) não impede as outras: cada uma roda no seu try e a falha sobe no exit code.
for (const cfg of fontes) {
  try {
    await rodarFonte(cfg, {
      supabase,
      maxLotes: Number(process.env.SUPORTENEXT_MAX_LOTES || 120),
      dryrun: process.env.SUPORTENEXT_DRYRUN !== '0',
      debug: process.env.SUPORTENEXT_DEBUG === '1',
      semBD: true,
      // Catálogo vazio ou só de lote encerrado (Marco Aurélio: praças de 2023) é estado normal destes sites — vira
      // linha em fonte_saude, não passo vermelho. Erro de gravação continua marcando exit 1 (o runner faz).
      exitCodeSeFalha: false,
    });
  } catch (e) {
    console.error(`[${cfg.chave}] falhou: ${e?.stack || e}`);
    process.exitCode = 1;
  }
}
