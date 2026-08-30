#!/usr/bin/env node
/**
 * RADAR DE EDITAIS (DJEN/CNJ) PELO IP RESIDENCIAL — R$ 0, sem Bright Data.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE (decisão do dono, 29/08): *"vou rodar diariamente, migra o radar; caso fique
 * 7 dias sem rodar no residencial, pode rodar pelo Bright Data."*
 *
 * O DJEN bloqueia IP de DATACENTER — é por isso que a versão da Vercel precisava do Web
 * Unlocker. O bloqueio é por CLASSE DE IP, não por assinatura de requisição: o Bright Data
 * passava porque sai por IP residencial. **De casa o IP já é residencial**, então o
 * intermediário pago é dispensável. Era o 2º maior consumidor da cota (106 requests na semana
 * de 24/08; 88 num único dia).
 *
 * ─── ZERO PARSER PRÓPRIO, DE PROPÓSITO ─────────────────────────────────────────────────────
 * Tudo que não é transporte — janela, filtro duro `ehEditalReal`, `parseEdital`, dedup por
 * `djen_id`, upsert — vem de `api/radar-editais-cron.js` (`pullDJEN`). Um parser copiado aqui
 * seria a repetição exata do defeito que o `roteiarDatasPraca` consertou em 29/08: a MESMA
 * regra em três cópias deixou o bug passar nas três. A ÚNICA diferença entre os dois caminhos
 * é a função de transporte.
 *
 * ─── COMO OS DOIS CAMINHOS CONVIVEM ────────────────────────────────────────────────────────
 * Este script grava `monitor_runs` com a MESMA `fonte` do cron ('radar-editais-djen') e
 * `origem: 'residencial'`. O freio do cron pago lê o ÚLTIMO run com `erro: null` — de qualquer
 * origem — e só libera o Bright Data depois de `RADAR_DIAS_REDE_SEGURANCA` (7) dias sem
 * sucesso. Ou seja: **rodando aqui todo dia, o caminho pago nunca é acionado**, e isso não
 * depende de nenhum carimbo novo nem de eu lembrar de avisar ninguém.
 *
 * O sinal é o RESULTADO, não a execução: sair com exit 0 sem ter trazido nada não conta como
 * sucesso (lição do RJ, 11/08 — carimbo de "coletei" com 10,3 dias de acervo defasado).
 *
 * USO (da máquina residencial, com ~/.bidpro-runner.env carregado):
 *   node scripts/radar-editais-residencial.mjs
 * Env opcionais: RADAR_TRIBUNAIS · RADAR_TERMOS · RADAR_RESIDENCIAL_HARD_MS (default 900000)
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { pullDJEN, construirEhIntegrado, janelaDJEN, transporteDireto } from '../api/radar-editais-cron.js';

const URL_BASE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !KEY) {
  console.error('[radar-residencial] defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY (~/.bidpro-runner.env)');
  process.exit(2);
}
// Sem maxDuration da Vercel aqui: 15 min é folga confortável para 12 combos × até 8 páginas
// num link doméstico, e ainda impede que uma noite ruim segure o runner para sempre.
const HARD_MS = Number(process.env.RADAR_RESIDENCIAL_HARD_MS || 900000);

const supabase = createClient(URL_BASE, KEY);
const t0 = Date.now();

// Quanto tempo faz desde o último pull BEM-SUCEDIDO (de qualquer caminho)? Duas coisas saem
// daqui: (a) pular se hoje já deu certo — o runner pode rodar mais de uma vez no dia e refazer
// o pull não traz nada novo; (b) o TAMANHO DA JANELA, porque 3 dias fixos depois de uma
// ausência de uma semana perderiam 4 dias de editais em silêncio (ver `janelaDJEN`).
let diasDesdeSucesso = Infinity, ultimoOkEm = null;
{
  const { data, error } = await supabase.from('monitor_runs')
    .select('ran_at').eq('fonte', 'radar-editais-djen').is('erro', null)
    .order('ran_at', { ascending: false }).limit(1);
  // `{ data, error }` do postgrest-js NÃO lança (forma nº 2). Sem checar `error`, uma leitura
  // falha viraria "nunca houve sucesso" — aqui isso só alargaria a janela (custo zero, é
  // fetch direto), mas o hábito de checar é o que impede a versão cara do mesmo engano.
  if (error) console.error(`[radar-residencial] não li o histórico (${error.message}) — janela máxima por precaução`);
  else if (data?.[0]?.ran_at) {
    ultimoOkEm = data[0].ran_at;
    diasDesdeSucesso = (Date.now() - Date.parse(ultimoOkEm)) / 86400000;
  }
}

const hojeUTC = new Date().toISOString().slice(0, 10);
if (ultimoOkEm && ultimoOkEm.slice(0, 10) === hojeUTC) {
  console.log(`[radar-residencial] pull já obtido hoje (${ultimoOkEm}) — nada a fazer.`);
  process.exit(0);
}

const { ini, fim, dias } = janelaDJEN(diasDesdeSucesso === Infinity ? 15 : diasDesdeSucesso);
console.log(`[radar-residencial] janela ${ini} → ${fim} (${dias} dia(s); último sucesso: ${ultimoOkEm || 'nunca'})`);

const ehIntegrado = await construirEhIntegrado(supabase);
const r = await pullDJEN({ supabase, ini, fim, ehIntegrado, t0, transporte: transporteDireto, hardMs: HARD_MS });

// Run PARCIAL não é sucesso — grava com `erro` para que o dia siga em aberto e o freio do
// caminho pago continue contando. Foi o conserto de 19/08: um corte por tempo gravava
// `erro: null` e encerrava a captura do dia inteiro anunciando sucesso.
const erro = r.erroGeral || (r.cortadoPorTempo ? 'corte_por_tempo (run parcial — repuxar)' : null);
const { error: eLog } = await supabase.from('monitor_runs').insert({
  fonte: 'radar-editais-djen', origem: 'residencial',
  janela_inicio: ini, janela_fim: fim,
  itens_vistos: r.vistos, itens_novos: r.novos, duracao_ms: Date.now() - t0, erro,
});
// Este insert NÃO é best-effort, e a diferença importa: é ele que o freio do caminho pago lê.
// Se ele falhar em silêncio, o cron da Vercel conclui "faz 7 dias que ninguém coleta" e paga
// Bright Data por um trabalho que já foi feito de graça — o gasto duplicado que a sessão 14h
// acabou de fechar, voltando por outra porta.
if (eLog) {
  console.error(`[radar-residencial] ⚠️ coletei (${r.vistos} vistos, ${r.novos} novos) mas NÃO GRAVEI o run: ${eLog.message}`);
  console.error('   → o freio do cron pago não vai enxergar este sucesso e o Bright Data pode rodar por cima.');
  process.exit(3);
}

console.log(`[radar-residencial] vistos=${r.vistos} novos=${r.novos} descartados=${r.descartados}`
  + ` duracao=${((Date.now() - t0) / 1000).toFixed(1)}s${erro ? ` erro=${erro}` : ''}`);
// Sem editais NOVOS é desfecho normal (o DJEN é diário e o dedup corta a repetição da janela);
// o que reprova é não ter conseguido LER. `vistos = 0` com erro é falha; sem erro é dia vazio.
if (erro) process.exit(1);
