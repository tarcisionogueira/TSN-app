#!/usr/bin/env node
/**
 * RADAR DE EDITAIS POR LEILOEIRO (DJEN/CNJ) PELO IP RESIDENCIAL — R$ 0, sem Bright Data. (28/10)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O radar por termo (`radar-editais-residencial.mjs`) só olha RADAR_TRIBUNAIS (TJSP, TRT15, TJMG, TJPR, TJES). Os 711
 * leiloeiros ATIVOS da junta SEM site só aparecem quando publicam edital — e publicam no tribunal que os nomeou, em
 * qualquer estado. Medido em 28/10 (amostra de 39 sem site, 60 dias): 3 com edital de leilão (8%), entre eles Roberto
 * Jacinto Pinho Júnior (JUCEPE) com 115 editais em 40 processos do TRT6 — tribunal fora do radar.
 *
 * Este script busca cada um PELO NOME, nacionalmente, numa fatia rotativa (1/RADAR_LEIL_CICLO dos nomes por dia, pela
 * ordem estável do id — em CICLO dias passa por todos) e grava pelo MESMO `pullDJENPorLeiloeiro` → `linhaDoItem` →
 * `gravarIneditas` do radar por termo: filtro duro, parser e dedup por djen_id idênticos.
 *
 * `monitor_runs.fonte` PRÓPRIA ('radar-editais-djen-leiloeiros'), de propósito: o freio do caminho pago do radar por
 * termo lê o último sucesso de 'radar-editais-djen'; se esta busca gravasse lá, um dia em que só ela rodasse calaria o
 * radar principal. E não há caminho pago para ela — DJEN bloqueia IP de datacenter, então só roda de casa.
 *
 * Env: RADAR_LEIL_CICLO (7) · RADAR_LEIL_JANELA_DIAS (10 — maior que o ciclo, para não perder edital entre as voltas)
 *      RADAR_LEIL_MAX (0 = a fatia do dia; >0 limita) · RADAR_LEIL_HARD_MS (900000) · RADAR_LEIL_SO_LER=1 (não grava)
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { pullDJENPorLeiloeiro, construirEhIntegrado, transporteDireto } from '../api/radar-editais-cron.js';

const URL_BASE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !KEY) {
  console.error('[radar-leiloeiros] defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY (~/.bidpro-runner.env)');
  process.exit(2);
}
const CICLO = Math.max(1, Number(process.env.RADAR_LEIL_CICLO || 7));
const JANELA = Math.max(1, Number(process.env.RADAR_LEIL_JANELA_DIAS || 10));
const MAX = Number(process.env.RADAR_LEIL_MAX || 0);
const HARD_MS = Number(process.env.RADAR_LEIL_HARD_MS || 900000);
const SO_LER = process.env.RADAR_LEIL_SO_LER === '1';
const FONTE = 'radar-editais-djen-leiloeiros';

const supabase = createClient(URL_BASE, KEY);
const t0 = Date.now();

const hojeUTC = new Date().toISOString().slice(0, 10);
if (!SO_LER) {
  const { data, error } = await supabase.from('monitor_runs').select('ran_at')
    .eq('fonte', FONTE).is('erro', null).gte('ran_at', `${hojeUTC}T00:00:00Z`).limit(1);
  if (!error && data?.length) { console.log(`[radar-leiloeiros] fatia de hoje já buscada (${data[0].ran_at}) — nada a fazer.`); process.exit(0); }
}

// Os sem site: ATIVO e sem domínio na junta. Ordem estável por id; fatia do dia = posição % CICLO.
const { data: junta, error: eJ } = await supabase.from('leiloeiro_junta').select('id, nome, nome_norm')
  .eq('situacao', 'ATIVO').is('dominio', null).order('id').limit(5000);
if (eJ) { console.error(`[radar-leiloeiros] não li a junta: ${eJ.message}`); process.exit(1); }
const nomesUnicos = [...new Map((junta || []).filter((r) => String(r.nome_norm || '').length >= 8).map((r) => [r.nome_norm, r.nome])).values()];
const dia = Math.floor(Date.now() / 86400000);
let fatia = nomesUnicos.filter((_, i) => i % CICLO === dia % CICLO);
if (MAX > 0) fatia = fatia.slice(0, MAX);

const fim = hojeUTC;
const ini = new Date(Date.now() - JANELA * 86400000).toISOString().slice(0, 10);
console.log(`[radar-leiloeiros] ${fatia.length} de ${nomesUnicos.length} leiloeiros sem site (fatia ${dia % CICLO}/${CICLO}) · janela ${ini} → ${fim}${SO_LER ? ' · SÓ LER' : ''}`);

const ehIntegrado = await construirEhIntegrado(supabase);
// SÓ LER: o mesmo pull, com um supabase que não grava — a contagem de editais reais sai igual, nada entra.
const destino = SO_LER ? {
  from: (t) => (t === 'editais_leilao'
    ? { select: () => ({ in: async () => ({ data: [] }) }), upsert: async () => ({ error: null }) }
    : supabase.from(t)),
} : supabase;
const r = await pullDJENPorLeiloeiro({ supabase: destino, nomes: fatia, ini, fim, ehIntegrado, t0, transporte: transporteDireto, hardMs: HARD_MS });

for (const c of r.comEdital) console.log(`   ${c.nome}: ${c.editais} edital(is)`);
const erro = r.erroGeral || (r.cortadoPorTempo ? 'corte_por_tempo (fatia parcial)' : null);
console.log(`[radar-leiloeiros] buscados=${r.buscados} (falhas ${r.falhas}) vistos=${r.vistos} citam_o_nome=${r.citados}`
  + ` editais=${r.reais} ${SO_LER ? '(não gravados)' : `novos=${r.novos}`} leiloeiros_com_edital=${r.comEdital.length}`
  + ` duracao=${((Date.now() - t0) / 1000).toFixed(0)}s${erro ? ` erro=${erro}` : ''}`);
if (SO_LER) process.exit(0);

const { error: eLog } = await supabase.from('monitor_runs').insert({
  fonte: FONTE, origem: 'residencial', janela_inicio: ini, janela_fim: fim,
  itens_vistos: r.vistos, itens_novos: r.novos, duracao_ms: Date.now() - t0, erro,
  aviso: r.falhas ? `${r.falhas} de ${r.buscados} buscas falharam` : null,
});
if (eLog) console.error(`[radar-leiloeiros] ⚠️ não gravei o run: ${eLog.message}`);
if (erro) process.exit(1);
