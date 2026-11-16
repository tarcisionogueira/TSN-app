#!/usr/bin/env node
/**
 * MILAN LEILÕES — VEÍCULOS (16/11, pedido do dono). 100% GRÁTIS: agenda (`tipoCat=1`) e catálogo completo de cada
 * evento pela API pública `siteback.milanleiloes.com.br` (sem Cloudflare, sem Bright Data). Conversão e regras em
 * lib/milan-veiculos.mjs (as mesmas de todo coletor de veículo: só veículo inteiro, sem valor não grava).
 *
 * Ciclo do leilão semanal (dono, 16/11): zera de quarta para quinta e reabastece na segunda. Por isso a rodada é
 * diária (scraper-milan.yml) e o lote de evento que saiu da agenda depois da data dele é desligado aqui.
 *
 * Env: MILAN_VEIC_DRYRUN (default '1' = não grava; o workflow passa '0').
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { registrarSaude } from './_saude-fonte.mjs';
import { agendaVeiculos, eventoSiteback, catalogoSiteback } from './lib/milan-siteback.mjs';
import { veiculoMilan, eventosEncerrados, loteDisponivel, FONTE } from './lib/milan-veiculos.mjs';

const DRYRUN = process.env.MILAN_VEIC_DRYRUN !== '0';
const SAUDE = `${FONTE}_VEICULOS`;
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Grupos de mesmo conjunto de colunas (coluna ausente num upsert misto viraria NULL — regra do motor de veículos).
async function gravar(rows) {
  const grupos = new Map();
  for (const r of rows) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  let n = 0;
  for (const g of grupos.values()) {
    for (let i = 0; i < g.length; i += 200) {
      const { data, error } = await supabase.from('veiculos_leilao').upsert(g.slice(i, i + 200), { onConflict: 'fonte,fonte_id' }).select('id');
      if (error) throw new Error(`upsert veiculos: ${error.message}`);
      n += data?.length || 0;
    }
  }
  return n;
}

async function desligar(ids, porque) {
  if (!ids.length) return 0;
  const { data, error } = await supabase.from('veiculos_leilao').update({ ativo: false, atualizado_em: new Date().toISOString() }).in('id', ids).select('id');
  if (error) { console.warn(`  desligar (${porque}) falhou: ${error.message}`); return 0; }
  return data.length;
}

async function main() {
  console.log(`MILAN VEÍCULOS ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · siteback (grátis)`);
  const agenda = await agendaVeiculos();
  console.log(`Agenda: ${agenda.length} leilão(ões) de veículos → ${agenda.map((e) => `${e.codLeilao} (${String(e.dataInicio).slice(0, 10)})`).join(', ') || '(nenhum)'}`);

  const rows = [], idsVistos = new Map(); // cod → Set(fonte_id) dos lotes disponíveis no catálogo
  const motivos = {};
  let enumerados = 0, falhos = 0;
  for (const item of agenda) {
    const cod = String(item.codLeilao);
    let ev, cat;
    try { ev = { ...item, ...(await eventoSiteback(cod)) }; cat = await catalogoSiteback(cod); }
    catch (e) { falhos++; console.error(`  evento ${cod}: FALHA (${e.message})`); continue; }
    const lotes = cat.lotes.conteudo;
    enumerados += lotes.length;
    const vistos = new Set();
    let n = 0;
    for (const l of lotes) {
      if (loteDisponivel(l)) vistos.add(`milan_veic_${cod}_${l.lote}`);
      const r = veiculoMilan(ev, l);
      if (r.row && !r.motivo) { rows.push(r.row); n++; } else motivos[r.motivo] = (motivos[r.motivo] || 0) + 1;
    }
    idsVistos.set(cod, vistos);
    console.log(`  evento ${cod} "${String(ev.tituloLeilao || '').slice(0, 60)}" · ${lotes.length} lote(s) no catálogo · ${n} gravável(is)`);
    await sleep(500);
  }
  console.log(`\nResumo: ${rows.length} pronto(s) · ${enumerados} no(s) catálogo(s) · fora: ${JSON.stringify(motivos)} · ${falhos} evento(s) sem leitura`);

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(rows.slice(0, 2), null, 2));
    return { dryrun: true, prontos: rows.length };
  }

  const gravados = rows.length ? await gravar(rows) : 0;
  console.log(`✅ ${gravados} veículo(s) MILAN gravados/atualizados.`);

  // DESLIGAMENTO PELO CICLO. Só com a agenda lida (lançaria acima): (a) evento que saiu da agenda e cuja data passou;
  // (b) lote de evento LIDO agora que não está mais disponível no catálogo (retirado/vendido).
  const { data: ativos, error } = await supabase.from('veiculos_leilao').select('id,fonte_id,data_leilao')
    .eq('fonte', FONTE).eq('ativo', true).like('fonte_id', 'milan_veic_%');
  if (error) console.warn(`  leitura dos ativos falhou (${error.message}) — desligamento pulado`);
  else {
    const fora = eventosEncerrados(ativos, new Set(agenda.map((e) => String(e.codLeilao))));
    const encerrados = ativos.filter((v) => fora.has((String(v.fonte_id).match(/^milan_veic_(\d+)_/) || [])[1])).map((v) => v.id);
    const retirados = ativos.filter((v) => {
      const cod = (String(v.fonte_id).match(/^milan_veic_(\d+)_/) || [])[1];
      return idsVistos.has(cod) && !idsVistos.get(cod).has(v.fonte_id);
    }).map((v) => v.id);
    const a = await desligar(encerrados, 'evento encerrado'), b = await desligar(retirados, 'saiu do catálogo');
    if (a || b) console.log(`  desligados: ${a} de evento(s) encerrado(s) · ${b} que saíram do catálogo`);
  }

  const semValor = motivos['sem valor'] || 0;
  if (falhos) {
    await registrarSaude(supabase, SAUDE, rows, 'siteback', { ok: false, enumerados, motivo: `coleta parcial: ${falhos} de ${agenda.length} evento(s) sem leitura` });
  } else if (!rows.length) {
    // Agenda vazia (entre o pregão de quarta e a reposição de segunda) ou catálogo só sem mínimo: resposta, não falha.
    await registrarSaude(supabase, SAUDE, [], 'siteback', { ok: false, vazio: true, enumerados,
      motivo: agenda.length ? `catálogo lido, nenhum lote com mínimo publicado (${semValor} sem valor)` : 'agenda lida, nenhum leilão de veículos aberto' });
  } else {
    await registrarSaude(supabase, SAUDE, rows, 'siteback', { enumerados });
  }
  return { gravados, enumerados, semValor, falhos };
}

main()
  .then((r) => { console.log(`[milan-veiculos] fim → ${JSON.stringify(r)}`); process.exit(0); })
  .catch(async (e) => {
    console.error(`[milan-veiculos] FALHA: ${e?.message || e}`);
    try { await registrarSaude(supabase, SAUDE, [], 'siteback', { ok: false, motivo: `falha de acesso: ${String(e?.message || e).slice(0, 200)}` }); }
    catch (e2) { console.error('[milan-veiculos] saúde não registrada:', e2?.message || e2); }
    process.exit(1);
  });
