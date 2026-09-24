/**
 * Recon do RESULTADO na página do lote (24/09) — só leitura da fonte; grava o texto em `recon_dump`
 * (origem 'resultado_pagina') para calibrar `api/_resultado-leilao.js` fonte a fonte (ZUK/FRAZAO
 * davam 'indeterminado' mesmo lidos depois do leilão). Fetch direto — sem Bright Data, custo zero.
 * Env: URLS (vírgula), VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { apurarResultadoDoTexto } from '../api/_resultado-leilao.js';

const SB = process.env.VITE_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const urls = String(process.env.URLS || '').split(',').map(s => s.trim()).filter(Boolean);
const RE_CHAVE = /(lance|vend|arremat|encerr|desert|licitant|situa|status|finaliz|resultado|proposta|negativ|suspens|cancel|retirad)/gi;

for (const url of urls) {
  let status = 0, html = '', erro = null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'pt-BR' }, signal: AbortSignal.timeout(20000) });
    status = r.status; html = await r.text();
  } catch (e) { erro = String(e.message || e); }
  const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const trechos = [];
  let m; RE_CHAVE.lastIndex = 0;
  while ((m = RE_CHAVE.exec(txt)) && trechos.length < 60) trechos.push(txt.slice(Math.max(0, m.index - 80), m.index + 120));
  // blocos de dados embutidos (Next/Nuxt/JSON) que citam status — o resultado às vezes só está ali
  const json = (html.match(/"(status|situacao|situation|statusLote|lot_status)[^"]{0,20}"\s*:\s*"[^"]{0,60}"/gi) || []).slice(0, 40);
  const conteudo = { url, status, erro, html_len: html.length, parser: apurarResultadoDoTexto(html), trechos, json, texto: txt.slice(0, 15000) };
  console.log(`${status} ${html.length}B parser=${JSON.stringify(conteudo.parser)} trechos=${trechos.length} json=${json.length} ${url}`);
  const r = await fetch(`${SB}/rest/v1/recon_dump`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ origem: 'resultado_pagina', chave: url, conteudo }) });
  if (!r.ok) console.log(`  ⚠️ recon_dump: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}
