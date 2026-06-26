#!/usr/bin/env node
/**
 * FASE 2 — Scraper de leiloeiros guiado pelo registro (leiloeiros_fontes)
 * ────────────────────────────────────────────────────────────────────────────
 * Fluxo por leiloeiro ATIVO:
 *   1. Canal: se canal_preferido='api' e api_url ok → usa API; senão scraper.
 *   2. Lista páginas → coleta links de detalhe → visita cada um via proxy.
 *   3. Extrai (heurística → IA), checa qualidade (data obrigatória, salvo
 *      venda direta), deduplica e faz upsert em imoveis_leilao.
 *   4. Atualiza métricas no registro (ultima_contagem, taxa_qualidade).
 *
 * Sem chave de proxy os fetches caem para direto (provável bloqueio antibot) —
 * a estrutura roda, mas o volume real só vem com PROXY_PROVIDER+chave.
 *
 * Variáveis: PILOTO_LIMITE (nº de leiloeiros), PILOTO_MAX_DETALHE (teto de
 * páginas de detalhe por leiloeiro, protege a cota na fase de testes).
 */
import { createClient } from '@supabase/supabase-js';
import {
  fetchViaProxy, extrairLinksListagem, extrairImovel,
  chaveDedup, checarQualidade, flushUso, usoAtual,
} from './lib/scraper-core.mjs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PILOTO_LIMITE      = parseInt(process.env.PILOTO_LIMITE || '5', 10);
const PILOTO_MAX_DETALHE = parseInt(process.env.PILOTO_MAX_DETALHE || '40', 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function processarLeiloeiro(lj) {
  const t0 = Date.now();
  console.log(`\n📋 ${lj.nome} (${lj.uf}) — canal ${lj.canal_preferido}`);
  const imoveis = [];
  let detalhesVisitados = 0;

  // ── Coleta de links via listagem (paginação) ──
  const links = new Set();
  for (let pag = 1; pag <= (lj.max_paginas || 10); pag++) {
    const url = `${lj.url_base}${pag}`;
    const r = await fetchViaProxy(url, supabase);
    if (r.motivo === 'limite_atingido') { console.log('   ⏸ limite de cota atingido'); break; }
    if (!r.ok) { console.log(`   pág ${pag}: falha (${r.status || r.motivo})`); break; }
    const novos = extrairLinksListagem(r.html, url);
    if (novos.length === 0) break; // sem mais resultados
    novos.forEach(u => links.add(u));
    await sleep(400);
  }
  console.log(`   ${links.size} links de detalhe encontrados`);

  // ── Visita detalhes, extrai e valida ──
  for (const url of links) {
    if (detalhesVisitados >= PILOTO_MAX_DETALHE) { console.log('   (teto de detalhes do piloto atingido)'); break; }
    const r = await fetchViaProxy(url, supabase);
    if (r.motivo === 'limite_atingido') break;
    if (!r.ok) continue;
    detalhesVisitados++;

    const { imovel, qualidade, descartar } = await extrairImovel(r.html, url);
    if (descartar) continue; // sem data (não venda direta) ou sem valor

    imoveis.push({
      fonte: lj.nome.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
      fonte_id: `${lj.id}_${url.split('/').filter(Boolean).pop()}`.slice(0, 80),
      titulo: imovel.titulo,
      estado: lj.uf !== 'BR' ? lj.uf : null,
      valor_minimo: imovel.valor_minimo,
      valor_avaliacao: imovel.valor_avaliacao || imovel.valor_minimo,
      link_foto: imovel.link_foto,
      link_edital: imovel.link_edital,
      link_matricula: imovel.link_matricula,
      url_lote: url,
      descricao: imovel.descricao,
      data_leilao: imovel.data_leilao,
      numero_matricula: imovel.numero_matricula,
      leiloeiro: lj.nome,
      dedup_chave: chaveDedup({ ...imovel, cidade: null, endereco: imovel.titulo }),
      qualidade_ok: qualidade.ok,
      qualidade_faltando: qualidade.faltando.join(',') || null,
      ativo: true,
      atualizado_em: new Date().toISOString(),
    });
    await sleep(300);
  }

  // ── Deduplicação contra o que já existe + upsert ──
  let salvos = 0;
  if (imoveis.length) {
    // Remove duplicados internos (mesma dedup_chave) mantendo o de menor valor
    const porChave = new Map();
    for (const im of imoveis) {
      const k = im.dedup_chave || im.fonte_id;
      const ex = porChave.get(k);
      if (!ex || (im.valor_minimo && im.valor_minimo < ex.valor_minimo)) porChave.set(k, im);
    }
    const finais = [...porChave.values()];
    const { error } = await supabase.from('imoveis_leilao')
      .upsert(finais, { onConflict: 'fonte,fonte_id', ignoreDuplicates: false });
    if (error) console.log(`   ⚠ erro upsert: ${error.message}`);
    else salvos = finais.length;
  }

  const completos = imoveis.filter(i => i.qualidade_ok).length;
  const taxa = imoveis.length ? +(completos / imoveis.length * 100).toFixed(1) : null;
  await supabase.from('leiloeiros_fontes').update({
    ultima_execucao: new Date().toISOString(),
    ultima_contagem: salvos,
    taxa_qualidade: taxa,
  }).eq('id', lj.id);

  console.log(`   ✅ ${salvos} salvos · qualidade ${taxa ?? '—'}% · ${detalhesVisitados} detalhes · ${((Date.now()-t0)/1000).toFixed(0)}s`);
  return { nome: lj.nome, salvos, taxa };
}

async function main() {
  console.log(`\n🏛️  Scraper de leiloeiros (piloto ${PILOTO_LIMITE}) — ${new Date().toISOString()}`);

  const { data: leiloeiros, error } = await supabase
    .from('leiloeiros_fontes')
    .select('*')
    .eq('ativo', true)
    .order('prioridade', { ascending: true })
    .limit(PILOTO_LIMITE);

  if (error) { console.error('Erro ao ler registro:', error.message); process.exit(1); }
  if (!leiloeiros?.length) { console.log('Nenhum leiloeiro ativo no registro.'); return; }

  const resultados = [];
  for (const lj of leiloeiros) {
    try { resultados.push(await processarLeiloeiro(lj)); }
    catch (e) { console.log(`   ❌ ${lj.nome}: ${e.message}`); }
    if (usoAtual().travado) { console.log('\n🛑 Cota mensal atingida — encerrando.'); break; }
  }

  await flushUso(supabase);
  const total = resultados.reduce((s, r) => s + (r.salvos || 0), 0);
  const uso = usoAtual();
  console.log(`\n✅ Concluído. ${total} imóveis salvos · ${uso.requisicoes} req proxy (~US$ ${uso.custo_usd}).`);
}

main().catch(e => { console.error(e); process.exit(1); });
