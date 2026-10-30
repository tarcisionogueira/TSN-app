#!/usr/bin/env node
/**
 * IMPORTA AS LISTAS DE LEILOEIROS CREDENCIADOS DOS TRIBUNAIS → `leiloeiro_tribunal` (29/10, pedido do dono).
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * A junta comercial não é o universo inteiro: o 1º cruzamento (29/10, 356 pessoas de TJSP, TRT15, TRT6, TRT18 e TRT4)
 * achou 14 credenciados que não estavam nem na junta, nem na triagem, nem no acervo. Este script refaz isso sozinho,
 * uma vez por semana, pelo runner de casa (os portais dos tribunais são públicos, mas IP de casa é o que já se mediu).
 *
 * Fontes (parser puro em lib/leiloeiro-tribunal-parse.mjs): TJSP (API JSON), EXE-PJe de cada TRT (API JSON; quem não
 * tem o módulo devolve 404 e é pulado), planilhas publicadas do TRT4 e TRT18.
 *
 * Contrato: uma fonte que FALHA não marca ninguém como sumido — só a lista lida inteira prova ausência (mesma regra da
 * varredura de sumidos do motor, #277). Ao fim, `leiloeiro_tribunal_cruzar()` recalcula `situacao_cadastro` e o log
 * lista quem está 'fora' (credenciado e sem nada nosso) — é a fila de integração da #381, e o radar por nome busca essas
 * pessoas no DJEN.
 *
 * Env: TRIB_FORCAR=1 (roda mesmo com sucesso nos últimos 6 dias) · TRIB_SO_LER=1 (não grava) · TRIB_TRTS ("1-24")
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { TJSP_URL, exeUrl, PLANILHAS, parseTJSP, parseEXE, parsePlanilha } from './lib/leiloeiro-tribunal-parse.mjs';

const URL_BASE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !KEY) {
  console.error('[tribunais] defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY (~/.bidpro-runner.env)');
  process.exit(2);
}
const SO_LER = process.env.TRIB_SO_LER === '1';
const FONTE = 'leiloeiros-tribunais';
const [trtDe, trtAte] = String(process.env.TRIB_TRTS || '1-24').split('-').map(Number);
const supabase = createClient(URL_BASE, KEY);
const t0 = new Date();

if (!SO_LER && process.env.TRIB_FORCAR !== '1') {
  const desde = new Date(Date.now() - 6 * 86400000).toISOString();
  const { data, error } = await supabase.from('monitor_runs').select('ran_at').eq('fonte', FONTE).is('erro', null).gte('ran_at', desde).limit(1);
  if (!error && data?.length) { console.log(`[tribunais] importado em ${data[0].ran_at} — a lista muda pouco; volta em 7 dias.`); process.exit(0); }
}

// Identificação honesta (sem fingir navegador): o fetch do Node sai sem User-Agent útil e alguns TRTs recusam com 403.
const UA = 'BidProBrasil/1.0 (+https://bidprobrasil.com.br; lista publica de leiloeiros credenciados)';
async function baixar(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(90000), headers: { Accept: 'application/json, text/csv, */*', 'User-Agent': UA, ...(init.headers || {}) } });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.text();
}

// Cada fonte devolve as linhas de UM tribunal; `null` = não deu para ler (não prova ausência de ninguém).
const fontes = [
  ['TJSP', async () => parseTJSP(JSON.parse(await baixar(TJSP_URL, {
    method: 'POST', body: 'sort=&page=1&pageSize=1000&group=&filter=&Nome=&Tipo=9&CodigoEspecialidade=',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
  })))],
  ...Object.entries(PLANILHAS).map(([trib, url]) => [trib, async () => parsePlanilha(await baixar(url), trib, trib === 'TRT4' ? 'RS' : null)]),
];
for (let n = trtDe; n <= trtAte; n++) {
  if (PLANILHAS[`TRT${n}`]) continue;   // TRT4/TRT18 publicam planilha; o EXE deles não lista
  fontes.push([`TRT${n}`, async () => {
    const out = [];
    for (let p = 1; p <= 20; p++) {
      let json;
      try { json = JSON.parse(await baixar(exeUrl(n, p))); }
      catch (e) { if (e.status === 404 && p === 1) return []; throw e; }   // 404 = TRT sem o módulo EXE: lista vazia, não falha
      out.push(...parseEXE(json, `TRT${n}`));
      if (p >= Number(json.qtdPaginas || 1)) break;
    }
    return [...new Map(out.map((r) => [r.chave, r])).values()];   // id repetido entre páginas
  }]);
}

const falhas = [];
let lidos = 0;
for (const [trib, ler] of fontes) {
  let rows;
  try { rows = await ler(); }
  catch (e) { falhas.push(`${trib}: ${e.message}`); console.log(`   ${trib}: ✗ ${e.message} — ninguém dele é marcado como sumido`); continue; }
  if (!rows.length) continue;
  lidos += rows.length;
  console.log(`   ${trib}: ${rows.length} leiloeiro(s)`);
  if (SO_LER) continue;
  const agora = new Date().toISOString();
  const { error } = await supabase.from('leiloeiro_tribunal')
    .upsert(rows.map((r) => ({ ...r, ativo: true, visto_em: agora })), { onConflict: 'tribunal,chave' });
  if (error) { falhas.push(`${trib}: gravar: ${error.message}`); continue; }
  // Lista lida inteira: quem do tribunal não veio agora saiu do credenciamento.
  const { error: eSum } = await supabase.from('leiloeiro_tribunal').update({ ativo: false })
    .eq('tribunal', trib).eq('ativo', true).lt('visto_em', t0.toISOString());
  if (eSum) falhas.push(`${trib}: sumidos: ${eSum.message}`);
}

if (SO_LER) { console.log(`[tribunais] SÓ LER — ${lidos} linhas lidas, nada gravado${falhas.length ? ` · falhas: ${falhas.join(' | ')}` : ''}`); process.exit(0); }

const { data: cruz, error: eCruz } = await supabase.rpc('leiloeiro_tribunal_cruzar');
if (eCruz) falhas.push(`cruzar: ${eCruz.message}`);
const por = Object.fromEntries((cruz || []).map((r) => [r.situacao, Number(r.n)]));
const { data: fora } = await supabase.from('leiloeiro_tribunal').select('tribunal, nome, dominio, primeiro_visto_em')
  .eq('ativo', true).eq('situacao_cadastro', 'fora').order('primeiro_visto_em', { ascending: false }).limit(200);
const novosFora = (fora || []).filter((r) => r.primeiro_visto_em >= t0.toISOString());
console.log(`[tribunais] ${lidos} linhas · cruzamento: ${JSON.stringify(por)}`);
console.log(`[tribunais] fora do cadastro (credenciados sem nada nosso): ${(fora || []).length}${novosFora.length ? ` — ${novosFora.length} NOVO(S) nesta importação` : ''}`);
for (const r of (fora || []).slice(0, 40)) console.log(`   ${r.primeiro_visto_em >= t0.toISOString() ? '🆕 ' : ''}${r.tribunal} · ${r.nome}${r.dominio ? ` · ${r.dominio}` : ''}`);

const hoje = t0.toISOString().slice(0, 10);
const erro = falhas.length && !lidos ? falhas.join(' | ').slice(0, 400) : null;
const { error: eLog } = await supabase.from('monitor_runs').insert({
  fonte: FONTE, origem: 'residencial', janela_inicio: hoje, janela_fim: hoje,
  itens_vistos: lidos, itens_novos: novosFora.length, duracao_ms: Date.now() - t0.getTime(), erro,
  aviso: falhas.length ? falhas.join(' | ').slice(0, 400) : null,
});
if (eLog) console.error(`[tribunais] ⚠️ não gravei o run: ${eLog.message}`);
if (erro) process.exit(1);
