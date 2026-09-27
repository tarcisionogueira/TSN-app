#!/usr/bin/env node
/**
 * Scraper MILAN LEILÕES (milanleiloes.com.br) — Bright Data Web Unlocker (propósito `milan`).
 *
 * Por que pago: o Cloudflare do site dá challenge até para o IP RESIDENCIAL do dono (recon do
 * PC, 27/09, recon_dump 62: "Just a moment..." nas 3 rotas). O Unlocker passa (ids 57/64).
 *
 * Por que barato: a coleta lê SÓ a home e as páginas de EVENTO de imóveis — o card do evento já
 * traz cidade/UF, tipo, área, lance mínimo, foto e status (ver lib/milan-parse.mjs). Custo por
 * rodada ≈ 1 + nº de eventos de imóveis (27/09: ~6), contra 1 por lote se abrisse cada um.
 *
 * Body VAZIO com HTTP 200 acontece no Unlocker (recon 27/09: evento 15582 voltou com 0 bytes e o
 * 15573 com 245 KB, na mesma rodada) — tratado como falha e tentado 1× de novo, nunca como
 * "evento sem lote" (forma #1 do CLAUDE.md: o erro dentro do 200).
 *
 * Env: MILAN_DRYRUN (default '1' = não grava), MILAN_MAX_EVENTOS (default 10).
 */
import { createClient } from '@supabase/supabase-js';
import { buscarViaBrightData, brightDataDisponivel, ErroBrightData } from '../api/_brightdata.js';
import { registrarSaude } from './_saude-fonte.mjs';
import { TENANTS, extrairEventosImoveis, parseEvento, montarRow, checarQualidade, ehDesafio } from './lib/milan-parse.mjs';

const T = TENANTS.milan;
const DRYRUN = process.env.MILAN_DRYRUN !== '0';
const MAX_EVENTOS = Number(process.env.MILAN_MAX_EVENTOS || 10);
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const METRICAS_ZERO = { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 };

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

class FalhaDeAcesso extends Error {
  constructor(motivo, detalhe, semCota = false) {
    super(detalhe ? `${motivo}: ${detalhe}` : motivo);
    this.motivo = motivo; this.semCota = semCota === true;
  }
}

// Página inteira pelo Unlocker. `minimo` = tamanho abaixo do qual o corpo não é página (o
// vazio-com-200 medido no recon). Uma nova tentativa; persistindo, lança com o motivo.
async function pagina(url, minimo = 5000) {
  let ultimo = '';
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    let r;
    try {
      r = await buscarViaBrightData(url, { proposito: 'milan', timeoutMs: 90000, exigirOk: false });
    } catch (e) {
      if (e instanceof ErroBrightData) throw new FalhaDeAcesso(e.motivo, e.detalhe || e.message, e.semCota);
      throw e;
    }
    const body = await r.text().catch(() => '');
    if (!r.ok) throw new FalhaDeAcesso('http', `HTTP ${r.status} em ${url}`);
    if (ehDesafio(body)) ultimo = 'challenge';
    else if (body.length < minimo) ultimo = `corpo com ${body.length} bytes`;
    else return body;
    console.log(`  ${url}: ${ultimo} — ${tentativa === 1 ? 'tentando de novo' : 'desistindo'}`);
    await sleep(2000);
  }
  throw new FalhaDeAcesso('pagina_invalida', `${ultimo} em ${url}`);
}

// Amostra dos cards sem valor → recon_dump (origem `milan-sem-valor`, 1×/20 h por evento). É
// diagnóstico: falhar aqui nunca derruba a coleta, mas o motivo vai para o log.
async function amostrarSemValor(cod, ev, cards) {
  try {
    const chave = `evento:${cod}`;
    const desde = new Date(Date.now() - 20 * 3600e3).toISOString();
    const { data: ja, error: eJa } = await supabase.from('recon_dump').select('id').eq('origem', 'milan-sem-valor').eq('chave', chave).gte('criado_em', desde).limit(1);
    if (eJa) { console.log(`    (amostra sem valor: não consegui checar — ${eJa.message})`); return; }
    if (ja?.length) return;
    const { error } = await supabase.from('recon_dump').insert({ origem: 'milan-sem-valor', chave,
      conteudo: { evento: ev.tituloEvento, inicio: ev.inicio, n: cards.length, cards: cards.slice(0, 3).map(c => ({ lote: c.lote, titulo: c.titulo, html: c.htmlSemValor })) } });
    console.log(`    ${cards.length} card(s) sem LANCE MÍNIMO — amostra ${error ? `NÃO gravada (${error.message})` : 'gravada em recon_dump (milan-sem-valor)'}`);
  } catch (e) { console.log(`    (amostra sem valor falhou: ${String(e?.message || e).slice(0, 120)})`); }
}

async function main() {
  if (!brightDataDisponivel()) throw new FalhaDeAcesso('sem_config', 'BRIGHTDATA_API_TOKEN/ZONE ausentes — o site só abre pelo Web Unlocker');
  console.log(`MILAN ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · até ${MAX_EVENTOS} evento(s)`);

  const home = await pagina(`${T.base}/`, 20000);
  const eventos = extrairEventosImoveis(home).slice(0, MAX_EVENTOS);
  console.log(`Home: ${eventos.length} evento(s) de imóveis → ${eventos.join(', ') || '(nenhum)'}`);
  if (!eventos.length) {
    // A home abriu (passou do tamanho mínimo) e não listou evento de imóvel: é resposta, não falha.
    await registrarSaude(supabase, T.fonte, [], 'milan', { ok: false, vazio: true, enumerados: 0, metricas: METRICAS_ZERO,
      motivo: 'home lida, nenhum leilão de imóveis na agenda' });
    return { gravados: 0, eventos: 0 };
  }

  const prontos = [];
  let enumerados = 0, encerrados = 0, reprovados = 0, eventosFalhos = 0, recusaCota = null;
  for (const cod of eventos) {
    let html;
    try {
      html = await pagina(`${T.base}/leilao/imoveis/${cod}`);
    } catch (e) {
      eventosFalhos++;
      console.error(`  evento ${cod}: FALHA (${e.motivo || e.message})`);
      if (e.semCota) { recusaCota = e.motivo; console.log(`  ⛔ parou por COTA — ${eventos.length - eventos.indexOf(cod)} evento(s) para a próxima rodada`); break; }
      continue;
    }
    const ev = parseEvento(html, cod, T.base);
    enumerados += ev.lotes.length;
    const semValor = ev.lotes.filter(l => l.htmlSemValor && !l.encerrado);
    if (semValor.length) await amostrarSemValor(cod, ev, semValor);
    console.log(`  evento ${cod} "${ev.tituloEvento}" · início ${ev.inicio || '?'} · ${ev.lotes.length} lote(s)`);
    for (const card of ev.lotes) {
      if (card.encerrado) { encerrados++; continue; }
      const row = montarRow(ev, card, T);
      const q = checarQualidade(row, { estrito: false });
      if (q.descartar) { reprovados++; console.log(`    ${card.lote} DESCARTADO (${q.faltando.join(',')})`); continue; }
      prontos.push(row);
    }
    await sleep(500);
  }
  console.log(`\nResumo: ${prontos.length} pronto(s) · ${enumerados} enumerado(s) · ${encerrados} encerrado(s) · ${reprovados} reprovado(s) · ${eventosFalhos} evento(s) sem acesso.`);

  if (!prontos.length) {
    // Nenhum evento abriu: falha de ACESSO (ou cota), nunca "fonte vazia".
    if (eventosFalhos === eventos.length) throw new FalhaDeAcesso(recusaCota || 'eventos_inacessiveis', `${eventosFalhos} de ${eventos.length} evento(s) sem acesso`, !!recusaCota);
    await registrarSaude(supabase, T.fonte, [], 'milan', { ok: false, enumerados, metricas: METRICAS_ZERO,
      motivo: `nenhum lote pronto (${encerrados} encerrados · ${reprovados} reprovados)` });
    return { gravados: 0, enumerados };
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    return { gravados: 0, dryrun: true, prontos: prontos.length };
  }

  const { data, error } = await supabase.from('imoveis_leilao')
    .upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false }).select('fonte_id');
  if (error) throw new FalhaDeAcesso('supabase', `upsert: ${error.message}`);
  if (!data?.length) throw new FalhaDeAcesso('supabase', 'upsert não devolveu nenhuma linha');
  console.log(`✅ ${data.length} imóvel(is) MILAN gravados/atualizados.`);

  const parcial = eventosFalhos > 0;
  await registrarSaude(supabase, T.fonte, prontos, 'milan', parcial
    ? { ok: false, semCota: !!recusaCota, enumerados, motivo: `coleta parcial: ${eventosFalhos} evento(s) sem acesso${recusaCota ? ' (cota)' : ''}` }
    : { enumerados });
  return { gravados: data.length, enumerados, eventosFalhos };
}

main()
  .then((r) => { console.log(`[milan] fim → ${JSON.stringify(r)}`); process.exit(0); })
  .catch(async (e) => {
    const motivo = e?.motivo || 'erro', semCota = e?.semCota === true;
    console.error(`[milan] ${semCota ? 'SEM COTA' : 'FALHA'} (${motivo}): ${e?.message || e}`);
    if (!(e instanceof FalhaDeAcesso)) console.error(e);
    try {
      await registrarSaude(supabase, T.fonte, [], 'milan', { ok: false, semCota, metricas: METRICAS_ZERO,
        motivo: semCota ? `SEM COTA Bright Data (${motivo}) — coleta não tentada (decisão de orçamento, não regressão da fonte)` : `falha de acesso: ${motivo}` });
    } catch (e2) { console.error('[milan] saúde não registrada:', e2?.message || e2); }
    process.exit(1);
  });
