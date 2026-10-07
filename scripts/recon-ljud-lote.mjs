/**
 * RECON DE UM LOTE LJUD (07/10) — SÓ LEITURA, grava em recon_dump (origem 'recon_ljud_lote').
 *   LJUD_LOTES="99369/217021,..." node scripts/recon-ljud-lote.mjs
 *
 * Caso do dono: lote bc7ed172 (ljud_217021) sem data e com o "valor de participação" errado; 83% dos
 * LJUD ativos estão sem avaliação. Para cada lote: abre a página no Chromium, guarda as respostas
 * JSON da API do portal que mencionam o lote (é daí que o coletor tira vl_lanceminimo/vl_ordenacao/
 * vl_avaliacao/dt_fechamento), o texto com datas e valores em R$, e lê o edital em PDF do lote.
 */
import puppeteer from 'puppeteer';
import { carregarPDFParse } from '../api/_pdf-safe.js';

const SB = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LOTES = String(process.env.LJUD_LOTES || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!SB || !KEY || !LOTES.length) { console.error('defina VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY e LJUD_LOTES'); process.exit(1); }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const RE_DATA = /\b\d{2}\/\d{2}\/\d{4}(?:\s*(?:às|as|-|,)?\s*\d{1,2}[:h]\d{2})?/g;
const RE_RS = /R\$\s*[\d.]+,\d{2}/g;
const trechos = (t, re, n = 20) => [...String(t).matchAll(re)].slice(0, n).map((m) => String(t).slice(Math.max(0, m.index - 80), m.index + m[0].length + 20).replace(/\s+/g, ' '));
const PDFParse = await carregarPDFParse();

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const saida = [];
try {
  for (const par of LOTES) {
    const [leilaoId, loteId] = par.split('/');
    const item = { lote: par, api: [], pagina: null, edital: null };
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    page.on('response', async (r) => {
      try {
        if (!/api\.leiloesjudiciais/.test(r.url())) return;
        const t = await r.text();
        if (!t.includes(loteId)) return;
        // Só os campos que o coletor usa, do objeto do lote (evita gravar a página inteira).
        const j = JSON.parse(t);
        const acha = (o) => {
          if (!o || typeof o !== 'object') return null;
          if (String(o.lote_id) === loteId) return o;
          for (const v of Object.values(o)) { const x = acha(v); if (x) return x; }
          return null;
        };
        const o = acha(j);
        const campos = o ? Object.fromEntries(Object.entries(o).filter(([k]) => /^(vl_|dt_|statuslote|nm_titulo|praca|nr_praca)/.test(k))) : null;
        item.api.push({ url: r.url().slice(0, 160), campos });
      } catch { /* resposta não-JSON: ignora */ }
    });
    // Mesma chamada do coletor (scraperLJUD_navegador): fetch DENTRO da página, filtrada pelo leilão.
    try {
      await page.goto('https://www.leiloesjudiciais.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
      for (const endpoint of ['get-lotes', 'get-bens-por-estados']) {
        const url = `https://api.leiloesjudiciais.com.br/core/api/${endpoint}?pg=1&qtd_por_pagina=48&tipo=3&categoria=0&estado=0&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=${leilaoId}&lote_id=0&ordenacao=null`;
        const data = await page.evaluate(async (u) => {
          try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return r.ok ? await r.json() : { __status: r.status }; }
          catch (e) { return { __err: String(e?.message || e) }; }
        }, url);
        const items = (data && (data.items || data.data || (Array.isArray(data) ? data : []))) || [];
        const o = items.find((x) => String(x.lote_id) === loteId);
        const campos = o ? Object.fromEntries(Object.entries(o).filter(([k, v]) => /^(vl_|dt_|nu_|statuslote|praca|nr_)/.test(k) && typeof v !== 'object')) : null;
        item.api.push({ endpoint, status: data?.__status || data?.__err || 200, itens: items.length, campos });
      }
    } catch (e) { item.api.push({ erro: String(e?.message || e).slice(0, 120) }); }
    try {
      await page.goto(`https://www.leiloesjudiciais.com.br/lote/${leilaoId}/${loteId}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 4000));
      const txt = await page.evaluate(() => document.body?.innerText || '');
      const pdfs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /\.pdf/i.test(h)).slice(0, 5));
      item.pagina = { chars: txt.length, datas: trechos(txt, RE_DATA), valores: trechos(txt, RE_RS), pdfs };
    } catch (e) { item.pagina = { erro: String(e?.message || e).slice(0, 120) }; }
    finally { await page.close().catch(() => {}); }
    // Edital: o primeiro PDF da página, ou o link_edital do acervo
    const urlEdital = process.env[`EDITAL_${loteId}`] || item.pagina?.pdfs?.[0];
    if (urlEdital) {
      try {
        const r = await fetch(urlEdital, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
        const buf = Buffer.from(await r.arrayBuffer());
        const p = new PDFParse({ data: buf });
        try {
          const t = String((await p.getText())?.text || '').replace(/\s+/g, ' ');
          item.edital = { url: urlEdital, status: r.status, chars: t.length, datas: trechos(t, RE_DATA, 25), valores: trechos(t, RE_RS, 25) };
        } finally { await p.destroy().catch(() => {}); }
      } catch (e) { item.edital = { url: urlEdital, erro: String(e?.message || e).slice(0, 120) }; }
    }
    console.log(JSON.stringify(item).slice(0, 4000));
    saida.push(item);
  }
} finally { await browser.close().catch(() => {}); }

const w = await fetch(`${SB}/rest/v1/recon_dump`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ origem: 'recon_ljud_lote', chave: new Date().toISOString(), conteudo: saida }) });
console.log(w.ok ? '✅ gravado em recon_dump (recon_ljud_lote)' : `⚠️ recon_dump HTTP ${w.status}`);
