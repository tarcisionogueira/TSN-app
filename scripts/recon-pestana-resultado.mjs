/**
 * RECON — a API da PESTANA diz o RESULTADO do lote depois do pregão? (25/09, pedido do dono)
 *
 * POR QUE: PESTANA está fora de `apurar-resultado-leilao-cron.js` porque o `url_lote` é a AGENDA
 * do leilão inteiro (até 1.070 lotes na mesma URL) e a regex marcou 'vendido' falso em 21/09.
 * Mas o scraper já lê a API JSON por lote (`/api/v2/lote?leilao=`) e FILTRA `situacaoId=1`
 * (disponível) — ou seja, a API sabe a situação. Este recon só LÊ e imprime, para os leilões que
 * encerraram, a distribuição de `situacaoId`/nome da situação e todo campo com cara de lance/
 * arrematação, antes de escrever qualquer apuração (não chutar o significado de um código).
 * Não grava nada, não usa Bright Data (a API é same-origin e passa sem WAF pelo Chromium).
 *
 * Uso: PESTANA_LEILOES="6261,6252" node scripts/recon-pestana-resultado.mjs
 */
import puppeteer from 'puppeteer';

const BASE = 'https://www.pestanaleiloes.com.br';
const LEILOES = String(process.env.PESTANA_LEILOES || '6261,6252,6170,6180').split(',').map(s => s.trim()).filter(Boolean);
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const RE_CAMPO = /situa|status|lance|arremat|vend|venc|licit|result|encerr|condicion|proposta/i;

function camposInteressantes(obj, prefixo = '', out = {}, prof = 0) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && prof < 2) { camposInteressantes(v, `${prefixo}${k}.`, out, prof + 1); continue; }
    if (RE_CAMPO.test(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v))) out[prefixo + k] = v;
    if (Array.isArray(v) && RE_CAMPO.test(k)) out[prefixo + k] = `[array ${v.length}]` + (v[0] ? ' ' + JSON.stringify(v[0]).slice(0, 200) : '');
  }
  return out;
}

// 2ª rodada (25/09): a 1ª mostrou que `status` traz o texto ("Vendido", "Aguardando repasse",
// "Retirado", "Disponível", "Em pregão") com `situacaoId=1` até para vendido, e que `leilao=` é
// IGNORADO (toda chamada devolve a mesma lista). Agora cruza os lotes NOSSOS que encerraram nos
// últimos dias com o status que a API dá para eles — é isso que decide se dá para apurar.
async function lotesNossosEncerrados() {
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const desde = new Date(Date.now() - 4 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const r = await fetch(`${url}/rest/v1/imoveis_leilao?fonte=eq.PESTANA&data_fim=gte.${desde}&data_fim=lt.${hoje}&select=fonte_id,data_fim,ativo,resultado_leilao&limit=5000`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) { console.log('leitura do banco falhou HTTP', r.status); return null; }
  return r.json();
}

(async () => {
  const nossos = await lotesNossosEncerrados();
  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/lotes/imoveis`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Lista global paginada (o filtro por leilão não funciona), deduplicada por id.
    const porId = new Map();
    for (let pg = 1; pg <= 30; pg++) {
      const lote = await page.evaluate(async (pg) => {
        try { const res = await fetch(`/api/v2/lote?page=${pg}&qtd=300`, { headers: { Accept: 'application/json' } }); return res.ok ? await res.json() : null; }
        catch { return null; } // padrao-ok: recon só-leitura; null vira "sem lista — fim" impresso na linha seguinte
      }, pg);
      const arr = Array.isArray(lote) ? lote : (lote?.content || null);
      if (!Array.isArray(arr) || !arr.length) { console.log(`página ${pg}: ${arr ? 'vazia' : 'sem lista'} — fim`); break; }
      const antes = porId.size;
      arr.forEach(l => porId.set(Number(l.id), l));
      console.log(`página ${pg}: ${arr.length} lotes (${porId.size - antes} novos)`);
      if (porId.size === antes) break; // paginação ignorada: mesma lista de novo
    }
    console.log(`API: ${porId.size} lotes distintos`);
    if (Array.isArray(nossos)) {
      const dist = {};
      const ex = {};
      for (const n of nossos) {
        const id = Number(String(n.fonte_id || '').replace('pestana_', ''));
        const l = porId.get(id);
        const k = `${n.data_fim} · ${l ? `status="${l.status}"` : 'FORA DA API'} · arrematante=${l ? (l.arrematante ? 'sim' : 'vazio') : '-'}`;
        dist[k] = (dist[k] || 0) + 1;
        if (l && !ex[l.status]) ex[l.status] = { id, lanceInicial: l.lanceInicial, lanceMinimo: l.lanceMinimo, valor: l.valor, valorInicial: l.valorInicial, arrematante: l.arrematante, leilao: l.leilao, mensagemRetirada: l.mensagemRetirada };
      }
      console.log(`\n=== NOSSOS lotes PESTANA encerrados (${nossos.length}) × status na API ===`);
      Object.entries(dist).sort().forEach(([k, v]) => console.log(`  ${v}\t${k}`));
      console.log('exemplos por status:', JSON.stringify(ex, null, 1));
    }
    for (const id of LEILOES.slice(0, 1)) {
      const r = await page.evaluate(async (id) => {
        try {
          const res = await fetch(`/api/v2/lote?leilao=${id}&page=1&qtd=300`, { headers: { Accept: 'application/json' } });
          return { status: res.status, corpo: res.ok ? await res.json() : await res.text() };
        } catch (e) { return { status: 0, corpo: String(e) }; }
      }, id);
      const lista = Array.isArray(r.corpo) ? r.corpo : (r.corpo?.content || r.corpo?.data || r.corpo?.lotes || null);
      console.log(`\n=== LEILÃO ${id} · HTTP ${r.status} · ${Array.isArray(lista) ? lista.length + ' lotes' : 'SEM LISTA: ' + JSON.stringify(r.corpo).slice(0, 300)}`);
      if (!Array.isArray(lista) || !lista.length) continue;
      console.log('CHAVES do lote:', Object.keys(lista[0]).join(', '));
      const dist = {};
      for (const l of lista) {
        const k = `situacaoId=${l.situacaoId} · ${JSON.stringify(l.situacao ?? l.situacaoNome ?? l.status ?? null).slice(0, 80)}`;
        dist[k] = (dist[k] || 0) + 1;
      }
      console.log('DISTRIBUIÇÃO:', JSON.stringify(dist, null, 1));
      const vistos = new Set();
      for (const l of lista) {
        if (vistos.has(l.situacaoId)) continue;
        vistos.add(l.situacaoId);
        console.log(`  exemplo lote ${l.id} (situacaoId=${l.situacaoId}):`, JSON.stringify(camposInteressantes(l)).slice(0, 1500));
      }
      // Endpoint de lote único — às vezes traz lances/arrematante que a lista não traz.
      const um = await page.evaluate(async (lid) => {
        for (const u of [`/api/v2/lote/${lid}`, `/api/v2/lote/${lid}/lances`]) {
          try { const res = await fetch(u, { headers: { Accept: 'application/json' } }); const t = await res.text(); if (res.ok) return { u, t: t.slice(0, 2500) }; } catch { /* tenta o próximo */ }
        }
        return null;
      }, lista[0].id);
      console.log('  LOTE ÚNICO:', um ? `${um.u} → ${um.t}` : 'nenhum endpoint respondeu');
    }
  } finally { await browser.close(); }
})();
