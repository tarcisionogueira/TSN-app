/**
 * APURAÇÃO + DATAS pelo IP RESIDENCIAL — 24/09/2026 (pedido do dono).
 *
 * Por que existe: dois crons da Vercel dependem da MESMA subcota diária `geral` do Bright Data
 * (25/dia) e ela se esgota todo dia:
 *   • apurar-resultado-leilao-cron — a ZUK barra o Vercel (mesmo em gru1) e o fallback pago
 *     acaba: 128 lotes ZUK "sem conteúdo" na rodada de 24/09 18h UTC, com a página abrindo
 *     normalmente do GitHub e o leitor acertando (vendido R$ 199.680 / sem lance);
 *   • enriquecer-datas-cron — BIASI 384/388 e LJUD 666/933 ativos sem data, 2 lotes por dia.
 * Do IP de casa essas páginas abrem direto e de graça. Este script NÃO tem regra própria: usa o
 * MESMO leitor/gravação do cron (`apurarResultadoDoTexto` + `patchDaApuracao`) e a MESMA
 * extração de datas (`extrairDatasLeilao`) — uma cópia só de cada regra.
 *
 * Anti-bloqueio: SEQUENCIAL (uma página por vez, ~1,5 s entre elas) — é um IP só, de casa.
 * Página que não abriu NÃO é resultado nem "sem data": só carimba a hora (rodízio da fila) e não
 * gasta tentativa (forma nº 4 — ausência não é resposta).
 *
 * EM SECO POR PADRÃO (forma nº 10: rodar sobre dado real antes de gravar). Grava com RESID_APLICAR=1.
 * HEARTBEAT + RESERVA (24/09, regra do dono): cada parte que LEU páginas de verdade grava um
 * carimbo em `sistema_heartbeat` (ver api/_residencial.js). Enquanto ele tiver menos de 7 dias, os
 * crons da Vercel PULAM estas fontes (poupa a cota do Bright Data); passou de 7 dias sem carimbo,
 * os crons voltam a cobri-las pelo Bright Data, dentro das cotas. Rodar e não abrir nada NÃO carimba.
 * LJUD: o leitor dela é exato (rótulos "1º/2º Encerramento"), então ela é RELIDA em rodízio e a data
 * é SOBRESCRITA — corrige as gravadas pelo leitor antigo (início = dia da leitura, fim = "Ciclo").
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; RESID_APURAR / RESID_DATAS (fontes, padrão em
 *      api/_residencial.js); RESID_APURAR_LIMITE (300);
 *      RESID_DATAS_LIMITE (400); RESID_PAUSA_MS (1500).
 */
import { apurarResultadoDoTexto, patchDaApuracao } from '../api/_resultado-leilao.js';
import { extrairDatasLeilao } from '../api/enriquecer-lote.js';
import { FONTES_APURACAO_RESIDENCIAL, FONTES_DATAS_RESIDENCIAL, HB_APURACAO, HB_DATAS } from '../api/_residencial.js';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APLICAR = process.env.RESID_APLICAR === '1';
const lista = (v, pad) => String(v ?? pad).split(',').map(s => s.trim()).filter(Boolean);
const FONTES_APURAR = lista(process.env.RESID_APURAR, FONTES_APURACAO_RESIDENCIAL.join(','));
const FONTES_DATAS = lista(process.env.RESID_DATAS, FONTES_DATAS_RESIDENCIAL.join(','));
const LIM_APURAR = Number(process.env.RESID_APURAR_LIMITE || 300);
const LIM_DATAS = Number(process.env.RESID_DATAS_LIMITE || 400);
const PAUSA = Number(process.env.RESID_PAUSA_MS || 1500);
const MAX_TENTATIVAS = 3;       // o mesmo do cron
const JANELA_DIAS = 10;         // o mesmo do cron
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
// PATCH que PROVA o que mudou (forma nº 3): sem linha de volta, não gravou.
async function gravar(id, patch) {
  if (!APLICAR) return true;
  const rows = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return Array.isArray(rows) && rows.length === 1;
}
async function carimbar(chave, detalhe) {
  if (!APLICAR) return;
  await sb('rpc/registrar_heartbeat', { method: 'POST', body: JSON.stringify({ p_chave: chave, p_detalhe: detalhe }) })
    .catch(e => console.error(`  heartbeat ${chave} falhou (os crons podem voltar a cobrir estas fontes):`, e.message));
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function baixar(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,*/*;q=0.8' }, signal: AbortSignal.timeout(20000) });
    const html = await r.text();
    return r.ok && html.length > 500 ? { html } : { html: '', motivo: `HTTP ${r.status}` };
  } catch (e) {
    return { html: '', motivo: String(e?.message || e).slice(0, 80) };
  }
}
const hojeBRT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const inFontes = (fs) => `fonte=in.(${fs.map(f => `"${f}"`).join(',')})`;

console.log(`=== apurar-e-datar-residencial ${APLICAR ? '(GRAVANDO)' : '(EM SECO — nada é gravado)'} ===`);

// ── 1) APURAÇÃO (mesma fila do cron, só as fontes pedidas) ──────────────────────────────────
if (FONTES_APURAR.length) {
  const cand = await sb(`imoveis_leilao?and=(or(ativo.eq.true,suprimido_motivo.eq.praca_vencida),or(resultado_leilao.is.null,resultado_leilao.eq.indeterminado))`
    + `&data_fim=gte.${desde}&data_fim=lt.${hojeBRT}&resultado_apuracao_tentativas=lt.${MAX_TENTATIVAS}&${inFontes(FONTES_APURAR)}`
    + `&select=id,fonte,url_lote,link_edital,resultado_apuracao_tentativas,ativo`
    + `&order=resultado_apuracao_tentativas.asc,resultado_apurado_em.asc.nullsfirst,data_fim.desc&limit=${LIM_APURAR}`);
  const cont = { lidos: 0, vendido: 0, sem_lance: 0, cancelado: 0, aberto: 0, indeterminado: 0, nao_abriu: 0, nao_gravou: 0 };
  const motivos = {};
  for (const c of cand) {
    const alvo = c.url_lote || c.link_edital;
    if (!alvo || !/^https?:\/\//.test(alvo)) continue;
    const { html, motivo } = await baixar(alvo);
    if (!html) {
      cont.nao_abriu++; motivos[motivo] = (motivos[motivo] || 0) + 1;
      if (APLICAR) await sb(`imoveis_leilao?id=eq.${c.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ resultado_apurado_em: new Date().toISOString() }) }).catch(e => console.error('  carimbo falhou:', e.message));
      await dormir(PAUSA); continue;
    }
    cont.lidos++;
    const achado = apurarResultadoDoTexto(html, alvo);
    const patch = patchDaApuracao(achado, { tabela: 'imoveis_leilao', tentativasAntes: c.resultado_apuracao_tentativas, religarSeNaoVendido: c.ativo === false });
    const chave = achado?.aberto ? 'aberto' : (achado?.resultado || 'indeterminado');
    cont[chave] = (cont[chave] || 0) + 1;
    if (!APLICAR) console.log(`  [seco] ${c.fonte} ${chave}${achado?.valor ? ` R$ ${achado.valor}` : ''} ${alvo}`);
    else if (!(await gravar(c.id, patch))) cont.nao_gravou++;
    await dormir(PAUSA);
  }
  console.log(`[apuração] fontes=${FONTES_APURAR.join(',')} candidatos=${cand.length}`, JSON.stringify(cont), Object.keys(motivos).length ? `não abriu: ${JSON.stringify(motivos)}` : '');
  if (cont.lidos > 0 || !cand.length) await carimbar(HB_APURACAO, `${cont.lidos} lidos de ${cand.length}; não abriu ${cont.nao_abriu}`);
}

// ── 2) DATAS (mesma fila do enriquecer-datas-cron, só as fontes pedidas) ────────────────────
if (FONTES_DATAS.length) {
  const sel = `select=id,fonte,url_lote,link_edital,data_leilao,data_leilao_2`;
  const genericas = FONTES_DATAS.filter(f => f !== 'LJUD');
  const soFaltando = genericas.length ? await sb(`imoveis_leilao?ativo=eq.true&and=(or(data_leilao.is.null,data_leilao_2.is.null),or(link_edital.ilike.*//*/*,url_lote.ilike.*//*/*))`
    + `&modalidade=not.ilike.*venda*direta*&${inFontes(genericas)}&${sel}`
    + `&order=data_leilao.asc.nullsfirst,enriquecido_em.asc.nullsfirst&limit=${LIM_DATAS}`) : [];
  // LJUD em RODÍZIO (tenha data ou não): quem foi lido há mais tempo primeiro.
  const ljud = FONTES_DATAS.includes('LJUD') ? await sb(`imoveis_leilao?ativo=eq.true&fonte=eq.LJUD&url_lote=ilike.*//*/*&${sel}`
    + `&order=enriquecido_em.asc.nullsfirst&limit=${Math.ceil(LIM_DATAS / 2)}`) : [];
  const cand = [...soFaltando, ...ljud];
  const cont = { lidos: 0, com_inicio: 0, com_fim: 0, ja_encerrado: 0, sem_data_na_pagina: 0, nao_abriu: 0, nao_gravou: 0 };
  const porFonte = {};
  const motivos = {};
  for (const im of cand) {
    const alvo = im.url_lote || im.link_edital;
    if (!alvo || !/^https?:\/\//.test(alvo)) continue;
    const { html, motivo } = await baixar(alvo);
    if (!html) { cont.nao_abriu++; motivos[motivo] = (motivos[motivo] || 0) + 1; await dormir(PAUSA); continue; } // não carimba: volta na próxima
    cont.lidos++;
    const { inicio, fim, encerradaEm } = extrairDatasLeilao(html);
    const patch = { enriquecido_em: new Date().toISOString() };
    if (im.fonte === 'LJUD') {
      // Leitor exato → a página manda: sobrescreve (inclusive o "fim" vindo de um Ciclo, que vira nulo).
      if (inicio || encerradaEm) {
        const di = inicio || encerradaEm;
        if (String(im.data_leilao || '').slice(0, 10) !== di) { patch.data_leilao = di; if (inicio) cont.com_inicio++; else cont.ja_encerrado++; }
        if ((im.data_leilao_2 || null) !== (fim || null) && !(im.data_leilao_2 && fim && Date.parse(im.data_leilao_2) === Date.parse(fim))) { patch.data_leilao_2 = fim || null; if (fim) cont.com_fim++; }
      }
    } else {
      if (inicio && !im.data_leilao) { patch.data_leilao = inicio; cont.com_inicio++; }
      if (fim && !im.data_leilao_2) { patch.data_leilao_2 = fim; cont.com_fim++; }
      if (encerradaEm && !im.data_leilao && !im.data_leilao_2) { patch.data_leilao = encerradaEm; cont.ja_encerrado++; }
    }
    const achou = Object.keys(patch).length > 1;
    if (!achou) cont.sem_data_na_pagina++;
    porFonte[im.fonte] = porFonte[im.fonte] || { lidos: 0, com_data: 0 };
    porFonte[im.fonte].lidos++; if (achou) porFonte[im.fonte].com_data++;
    if (!APLICAR) console.log(`  [seco] ${im.fonte} ${achou ? JSON.stringify(patch) : 'sem data na página'} ${alvo}`);
    else if (!(await gravar(im.id, patch))) cont.nao_gravou++;
    await dormir(PAUSA);
  }
  console.log(`[datas] fontes=${FONTES_DATAS.join(',')} candidatos=${cand.length}`, JSON.stringify(cont), JSON.stringify(porFonte), Object.keys(motivos).length ? `não abriu: ${JSON.stringify(motivos)}` : '');
  if (cont.lidos > 0 || !cand.length) await carimbar(HB_DATAS, `${cont.lidos} lidos de ${cand.length}; não abriu ${cont.nao_abriu}`);
}
