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
import { confirmarMatriculas, copiarMatriculas } from './lib/milan-docs.mjs';
import { agendaImoveis, eventoSiteback, descobrirLote, cardDoEvento } from './lib/milan-siteback.mjs';

const T = TENANTS.milan;
const DRYRUN = process.env.MILAN_DRYRUN !== '0';
const MAX_EVENTOS = Number(process.env.MILAN_MAX_EVENTOS || 10);
const MAX_PAGINAS_EVENTO = Number(process.env.MILAN_MAX_PAGINAS_EVENTO || 8); // 20 lotes/página → até 160 por evento
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
  console.log(`MILAN ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · agenda pela siteback (grátis) · até ${MAX_EVENTOS} evento(s) de vários lotes pelo Bright Data`);

  // AGENDA PELA SITEBACK (05/11): grátis e completa. A home pelo Bright Data listava no máximo 10 eventos e falhava
  // (3 rodadas zeradas desde 05/10) — 14 dos 17 eventos de imóveis da agenda de 05/11 nunca tinham entrado.
  const agenda = await agendaImoveis();
  console.log(`Agenda: ${agenda.length} evento(s) de imóveis → ${agenda.map((e) => `${e.codLeilao}${Number(e.tipoLeilao) === 7 ? '(vários)' : ''}`).join(', ') || '(nenhum)'}`);
  if (!agenda.length) {
    // A agenda abriu e não listou imóvel: é resposta, não falha.
    await registrarSaude(supabase, T.fonte, [], 'milan', { ok: false, vazio: true, enumerados: 0, metricas: METRICAS_ZERO,
      motivo: 'agenda lida, nenhum leilão de imóveis' });
    return { gravados: 0, eventos: 0 };
  }

  // Lote já conhecido de cada evento (o número do lote não vem na siteback): evita sondar a foto de novo.
  const { data: conhecidos, error: eConh } = await supabase.from('imoveis_leilao').select('fonte_id,link_foto').eq('fonte', T.fonte);
  if (eConh) throw new FalhaDeAcesso('supabase', `lotes conhecidos: ${eConh.message}`);
  const loteConhecido = new Map();
  for (const r of conhecidos || []) {
    const m = String(r.fonte_id).match(/^milan_(\d+)_(\w+)$/i);
    if (m && !loteConhecido.has(m[1])) loteConhecido.set(m[1], { lote: m[2], foto: r.link_foto });
  }

  const prontos = [];
  let enumerados = 0, encerrados = 0, reprovados = 0, eventosFalhos = 0, semLote = 0, recusaCota = null, viaBD = 0;
  const multi = [];
  for (const item of agenda) {
    const cod = String(item.codLeilao);
    if (Number(item.tipoLeilao) === 7) { multi.push(cod); continue; }
    // LOTE ÚNICO — tudo grátis: detalhe na siteback, lote pela foto no repositório.
    let ev;
    try { ev = await eventoSiteback(cod); }
    catch (e) { eventosFalhos++; console.error(`  evento ${cod}: siteback falhou (${e.message})`); continue; }
    enumerados++;
    const achado = loteConhecido.get(cod) || await descobrirLote(ev.localFotos);
    if (!achado) { semLote++; console.log(`  evento ${cod}: lote não descoberto pela foto (${ev.localFotos || 'sem localFotos'}) — fica para a próxima`); continue; }
    const card = cardDoEvento(ev, achado);
    const judicial = !!card.processo;
    const row = montarRow({ cod, inicio: card.data_leilao, edital: null, judicial }, card, T);
    if (card.praca2.valor && card.praca2.valor !== row.valor_minimo) row.valor_minimo_2 = card.praca2.valor;
    if (card.data_leilao_2) row.data_leilao_2 = card.data_leilao_2;
    if (card.processo) row.numero_processo = card.processo;
    const q = checarQualidade(row, { estrito: false });
    if (q.descartar) { reprovados++; console.log(`    ${cod}_${card.lote} DESCARTADO (${q.faltando.join(',')})`); continue; }
    console.log(`  evento ${cod} (lote ${card.lote}) · ${row.titulo} · R$ ${row.valor_minimo}${row.valor_minimo_2 ? ` / 2ª R$ ${row.valor_minimo_2}` : ''}`);
    prontos.push(row);
  }

  // VÁRIOS LOTES — a lista só sai pela página do evento (desafio do Cloudflare): Bright Data, com teto.
  if (multi.length && !brightDataDisponivel()) console.log(`  ${multi.length} evento(s) de vários lotes sem Bright Data configurado — pulados`);
  for (const cod of (brightDataDisponivel() ? multi.slice(0, MAX_EVENTOS) : [])) {
    let html;
    try {
      viaBD++;
      html = await pagina(`${T.base}/leilao/imoveis/${cod}`);
    } catch (e) {
      eventosFalhos++;
      console.error(`  evento ${cod}: FALHA (${e.motivo || e.message})`);
      if (e.semCota) { recusaCota = e.motivo; console.log('  ⛔ parou por COTA — o resto fica para a próxima rodada'); break; }
      continue;
    }
    const ev = parseEvento(html, cod, T.base);
    // PAGINAÇÃO DO EVENTO (06/11, dono: "lote 022 do 15666 não aparece"): a página mostra 20 lotes e as seguintes ficam
    // em ?pagina=N (mapeamento do dono, 05/11). Só a 1ª era lida — o 15666 entrou até o 020. Segue enquanto a página
    // vem cheia e traz lote novo; cada página é 1 requisição do Bright Data, por isso o teto MAX_PAGINAS_EVENTO.
    const vistos = new Set(ev.lotes.map((l) => l.lote));
    for (let p = 2, ultima = ev.lotes.length; p <= MAX_PAGINAS_EVENTO && ultima >= 20; p++) {
      let h;
      try { viaBD++; h = await pagina(`${T.base}/leilao/imoveis/${cod}?pagina=${p}`); }
      catch (e) {
        console.error(`  evento ${cod} pág. ${p}: FALHA (${e.motivo || e.message}) — segue com ${ev.lotes.length} lote(s)`);
        if (e.semCota) recusaCota = e.motivo;
        break;
      }
      const novos = parseEvento(h, cod, T.base).lotes.filter((l) => !vistos.has(l.lote));
      for (const l of novos) { vistos.add(l.lote); ev.lotes.push(l); }
      ultima = novos.length;
      await sleep(500);
    }
    enumerados += ev.lotes.length;
    const semValor = ev.lotes.filter(l => l.htmlSemValor && !l.encerrado);
    if (semValor.length) await amostrarSemValor(cod, ev, semValor);
    console.log(`  evento ${cod} "${ev.tituloEvento}" · início ${ev.inicio || '?'} · ${ev.lotes.length} lote(s) (Bright Data)`);
    for (const card of ev.lotes) {
      if (card.encerrado) { encerrados++; continue; }
      const row = montarRow(ev, card, T);
      const q = checarQualidade(row, { estrito: false });
      if (q.descartar) { reprovados++; console.log(`    ${card.lote} DESCARTADO (${q.faltando.join(',')})`); continue; }
      prontos.push(row);
    }
    await sleep(500);
  }
  if (semLote) console.log(`  ${semLote} evento(s) de lote único sem lote descoberto.`);
  console.log(`\nResumo: ${prontos.length} pronto(s) · ${enumerados} enumerado(s) · ${encerrados} encerrado(s) · ${reprovados} reprovado(s) · ${eventosFalhos} evento(s) sem acesso.`);

  if (!prontos.length) {
    // Nenhum evento abriu: falha de ACESSO (ou cota), nunca "fonte vazia".
    if (eventosFalhos && eventosFalhos >= agenda.length) throw new FalhaDeAcesso(recusaCota || 'eventos_inacessiveis', `${eventosFalhos} de ${agenda.length} evento(s) sem acesso`, !!recusaCota);
    await registrarSaude(supabase, T.fonte, [], 'milan', { ok: false, enumerados, metricas: METRICAS_ZERO,
      motivo: `nenhum lote pronto (${encerrados} encerrados · ${reprovados} reprovados)` });
    return { gravados: 0, enumerados };
  }

  // Matrícula pelo repositório de arquivos (fetch direto, grátis — ver lib/milan-docs.mjs).
  const { achados, placar } = await confirmarMatriculas(prontos, { supabase });
  console.log(`  ${placar}`);

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    return { gravados: 0, dryrun: true, prontos: prontos.length };
  }

  const { data, error } = await supabase.from('imoveis_leilao')
    .upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false }).select('id,fonte_id');
  if (error) throw new FalhaDeAcesso('supabase', `upsert: ${error.message}`);
  if (!data?.length) throw new FalhaDeAcesso('supabase', 'upsert não devolveu nenhuma linha');
  console.log(`✅ ${data.length} imóvel(is) MILAN gravados/atualizados.`);
  console.log(`  ${await copiarMatriculas(supabase, data, achados)}`);

  const parcial = eventosFalhos > 0 || semLote > 0;
  await registrarSaude(supabase, T.fonte, prontos, 'milan', parcial
    ? { ok: false, semCota: !!recusaCota, enumerados, motivo: `coleta parcial: ${eventosFalhos} evento(s) sem acesso${recusaCota ? ' (cota)' : ''}${semLote ? ` · ${semLote} lote(s) único(s) sem número descoberto` : ''}` }
    : { enumerados });
  return { gravados: data.length, enumerados, eventosFalhos, semLote, viaBrightData: viaBD };
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
