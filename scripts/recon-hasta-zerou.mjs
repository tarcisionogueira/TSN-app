#!/usr/bin/env node
/**
 * RECON — por que a HASTA enumerou 0 com 579 lotes vivos? (29/08)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O QUE JÁ SE SABE, MEDIDO (não é hipótese):
 *   • última coleta boa: 25/08 com 579 lotes · primeiro zero: 29/08
 *   • 579 lotes ATIVOS, 0 com prazo vencido, `data_fim` 03/09 — o acervo está vivo
 *   • `data_leilao` (1ª praça) = **28/08**, `data_leilao_2` (2ª praça) = **03/09**
 *   • `puppeteer ok` na máquina do dono → NÃO é ambiente
 *   • o site respondeu (`fetchOk`), só não trouxe UM link `/item/<id>/detalhes`
 *
 * ─── A HIPÓTESE QUE A CRONOLOGIA SUGERE, E QUE ESTE RECON EXISTE PARA TESTAR ────────────────
 * A 1ª praça foi em **28/08** e o primeiro zero em **29/08** — dia seguinte. Se a listagem
 * `/lotes/imovel` filtra por "leilão em aberto", os lotes saem dela ao passar a 1ª praça e só
 * voltam (ou não) na 2ª. Nesse caso **o parser está intacto** e consertá-lo seria o pior
 * desfecho possível — foi exatamente o erro que quase se cometeu com o LEILOFY em 27/08.
 *
 * MAS a hipótese oposta é igualmente plausível (rota mudada, render mais lento, challenge), e
 * este script NÃO escolhe entre elas por argumento: ele MEDE as duas. O separador é o LOTE
 * CONHECIDO — se a página de detalhe de um lote que temos no acervo ainda abre e ainda mostra
 * a 2ª praça, o acervo existe e o problema é de LISTAGEM; se ela também não abre, o problema é
 * de ACESSO/rota e a conversa é outra.
 *
 * ZERO PARSER PRÓPRIO: importa `extrairUrlsDeLote` e `parseDetalhe` de `lib/hasta-parse.mjs`.
 * Um recon com parser próprio mede o parser do recon, não o de produção — e aí o veredito
 * descreve outra coisa (forma nº 10).
 *
 * CUSTO ZERO: Chromium residencial, sem Bright Data.
 *
 * USO (da máquina residencial, com ~/.bidpro-runner.env carregado):
 *   node scripts/recon-hasta-zerou.mjs
 * Env: RECON_ESPERAS (csv de ms, default 3500,8000,15000,25000) · RECON_LOTES (default 3)
 */
import { createClient } from '@supabase/supabase-js';
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';
import { extrairUrlsDeLote, parseDetalhe, TENANTS } from './lib/hasta-parse.mjs';

const BASE = TENANTS.hasta.base;
const ESPERAS = (process.env.RECON_ESPERAS || '3500,8000,15000,25000').split(',').map(Number);
const N_LOTES = Number(process.env.RECON_LOTES || 3);

// Sinais de que a página NÃO é a listagem que esperamos — cada um pede uma ação diferente,
// então são medidos separados em vez de virarem um "falhou" genérico.
const MARCADORES = [
  ['challenge', /just a moment|cf-browser-verification|checking your browser|attention required/i],
  ['login',     /\b(entrar|login|fa[çc]a seu login|acesse sua conta)\b[^<]{0,40}<\/(button|a)>/i],
  ['vazio_ux',  /nenhum (lote|item|resultado)|sem resultados|não (foram )?encontrad/i],
  ['erro_app',  /\b(erro|error)\b.{0,40}\b(500|interno|inesperado)\b/i],
];

function radiografia(html) {
  const h = String(html || '');
  const conta = (re) => (h.match(re) || []).length;
  return {
    bytes: h.length,
    itens_detalhes: extrairUrlsDeLote(h, BASE).size,       // o que o PARSER DE PRODUÇÃO acha
    item_solto: conta(/\/item\/\d+/g),                      // /item/<id> sem /detalhes
    palavra_lote: conta(/\bLOTE\s*\d/gi),
    marcas: MARCADORES.filter(([, re]) => re.test(h)).map(([n]) => n),
  };
}

/** Caminhos internos que a própria página publica — evidência, não palpite. */
function caminhosPublicados(html) {
  const out = new Set();
  for (const m of String(html || '').matchAll(/href=["']([^"'#]+)["']/gi)) {
    let h = m[1];
    if (/^https?:\/\//i.test(h)) { try { const u = new URL(h); if (!/hastaleiloes\.com\.br$/i.test(u.host.replace(/^www\./, ''))) continue; h = u.pathname + u.search; } catch { continue; } }
    if (!h.startsWith('/') || h.length < 2) continue;
    if (/\.(pdf|jpe?g|png|svg|css|js|ico|webp)$/i.test(h)) continue;
    if (!/leil|lote|item|imov|imóv|busca|catalog|venda|praca|praça/i.test(h)) continue;
    if (/\/item\/\d+/.test(h)) continue;              // lote solto não é caminho de catálogo
    out.add(h);
  }
  return [...out];
}

const linha = (rot, r) => `  ${rot.padEnd(38)} ${String(r.bytes).padStart(7)}B · itens=${String(r.itens_detalhes).padStart(3)}`
  + ` · /item solto=${String(r.item_solto).padStart(3)} · "LOTE n"=${String(r.palavra_lote).padStart(3)}`
  + (r.marcas.length ? ` · ⚠️ ${r.marcas.join(',')}` : '');

(async () => {
  console.log(`🔎 RECON HASTA — por que enumerou 0?\n   base: ${BASE}\n`);

  // ── 1) O RENDER É LENTO? Mesma URL do scraper, esperas crescentes. Se aparecer lote com
  //       espera maior, o conserto é uma linha (`dom.esperaMs`) e não há regressão de fonte.
  console.log(`1) LISTAGEM /lotes/imovel — o render só precisava de mais tempo?`);
  let melhorListagem = null;
  for (const ms of ESPERAS) {
    const html = await fetchHeadless(`${BASE}/lotes/imovel`, { timeoutMs: 90000, esperaMs: ms });
    if (html == null) { console.log(`  espera ${String(ms).padEnd(6)} → não consegui ler (≠ vazio)`); continue; }
    const r = radiografia(html);
    console.log(linha(`espera ${ms}ms`, r));
    if (!melhorListagem || r.itens_detalhes > melhorListagem.r.itens_detalhes) melhorListagem = { ms, r, html };
  }

  // ── 2) O ACERVO AINDA EXISTE? Lote que JÁ está no nosso banco. Este é o separador entre
  //       "problema de listagem" e "problema de acesso" — e usa o parser de PRODUÇÃO.
  console.log(`\n2) LOTES CONHECIDOS (do nosso acervo) — a página de detalhe ainda abre?`);
  const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: lotes, error: eLotes } = await sb.from('imoveis_leilao')
    .select('url_lote,fonte_id').eq('fonte', 'HASTA').eq('ativo', true)
    .not('url_lote', 'is', null).order('atualizado_em', { ascending: false }).limit(N_LOTES);
  if (eLotes) console.log(`  ⚠️ não li o acervo: ${eLotes.message}`);
  let detalhesOk = 0;
  for (const l of lotes || []) {
    const url = l.url_lote.replace(/\?.*$/, '');   // o `?page=` era da paginação, não do lote
    const html = await fetchHeadless(url, { timeoutMs: 90000, esperaMs: 8000 });
    if (html == null) { console.log(`  ${l.fonte_id}: não consegui ler`); continue; }
    const r = radiografia(html);
    let d = null;
    try { d = parseDetalhe(html, url); } catch (e) { console.log(`  ${l.fonte_id}: parseDetalhe lançou: ${e.message}`); }
    // Os nomes são os do parser de PRODUÇÃO (`valor_minimo`/`valor_avaliacao`); inventar
    // apelido aqui faria o recon medir campo que não existe e imprimir "—" para tudo — um
    // veredito de "site quebrado" fabricado pelo próprio instrumento.
    const ok = !!(d && (d.valor_minimo || d.valor_avaliacao));
    if (ok) detalhesOk++;
    console.log(`  ${l.fonte_id.padEnd(14)} ${r.bytes}B${r.marcas.length ? ` ⚠️ ${r.marcas.join(',')}` : ''}`
      + (d ? ` · mínimo=${d.valor_minimo ?? '—'} · aval=${d.valor_avaliacao ?? '—'}`
           + ` · praça1=${d.data_leilao ?? '—'} · praça2=${d.data_leilao_2 ? String(d.data_leilao_2).slice(0, 10) : '—'}`
           + ` · encerrado=${d.encerrado}` : ' · sem parse'));
  }

  // ── 3) QUE CAMINHOS O SITE PUBLICA HOJE? Se a listagem mudou de rota (ou ganhou filtro de
  //       praça), o menu do próprio site é onde isso aparece.
  console.log(`\n3) CAMINHOS DE CATÁLOGO QUE O SITE PUBLICA`);
  const home = await fetchHeadless(BASE, { timeoutMs: 90000, esperaMs: 8000 });
  const cands = new Set([...caminhosPublicados(home), ...caminhosPublicados(melhorListagem?.html)]);
  console.log(`  ${cands.size} candidato(s): ${JSON.stringify([...cands].slice(0, 25))}`);
  const testar = [...cands].filter((c) => c !== '/lotes/imovel').slice(0, 12);
  for (const c of testar) {
    const html = await fetchHeadless(`${BASE}${c}`, { timeoutMs: 90000, esperaMs: 8000 });
    if (html == null) { console.log(`  ${c.padEnd(38)} não consegui ler`); continue; }
    console.log(linha(c, radiografia(html)));
  }

  // ── VEREDITO — cada desfecho tem uma AÇÃO diferente, e é isso que precisa sair escrito.
  const enumerou = melhorListagem?.r.itens_detalhes || 0;
  console.log('\n═══ VEREDITO');
  if (enumerou > 0 && melhorListagem.ms > 3500) {
    console.log(`  ⏱️  RENDER LENTO: ${enumerou} lote(s) com espera ${melhorListagem.ms}ms (produção usa 3500).`);
    console.log(`      AÇÃO: subir \`dom.esperaMs\` em scripts/lib/motor/fontes/hasta.mjs. Parser intacto.`);
  } else if (enumerou > 0) {
    console.log(`  🔁 INTERMITENTE: agora enumerou ${enumerou} com a MESMA espera de produção.`);
    console.log(`      AÇÃO: nenhuma no parser. Rode o scraper de novo e confira fonte_saude.`);
  } else if (detalhesOk > 0) {
    console.log(`  📄 O ACERVO EXISTE, A LISTAGEM É QUE NÃO O MOSTRA (${detalhesOk}/${(lotes || []).length} detalhes abriram).`);
    console.log(`      A 1ª praça foi em 28/08 e o 1º zero em 29/08: a listagem provavelmente filtra`);
    console.log(`      por leilão ABERTO e os lotes voltam na 2ª praça (03/09).`);
    console.log(`      AÇÃO: NÃO mexer no parser. Ver na seção 3 se há caminho/filtro que os liste;`);
    console.log(`      se não houver, esperar 03/09 e só tratar como regressão se seguir zerado.`);
  } else {
    console.log(`  🚫 NEM LISTAGEM NEM DETALHE responderam com conteúdo — é ACESSO, não parser.`);
    console.log(`      AÇÃO: olhar as marcas (challenge/login) acima antes de mexer em qualquer regex.`);
  }
  await fecharHeadless();
})().catch(async (e) => { console.error(e); await fecharHeadless(); process.exit(1); });
