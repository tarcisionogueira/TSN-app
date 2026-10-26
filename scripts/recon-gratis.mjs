/**
 * RECON GRÁTIS DO RUNNER DO GITHUB (26/10) — busca uma lista de páginas com `fetch` puro (GET ou POST de
 * formulário), imprime status/tamanho/contagens e, com RECON_DUMP=1, grava o corpo em `recon_dump`
 * (origem `recon-gratis`) para a sessão ler pelo banco. Existe porque o pg_net (banco) só faz GET/POST JSON:
 * plataforma que lista o catálogo só por POST de FORMULÁRIO (MSIS `Principal.asp`, acaoDest/pag) e site que
 * recusa o IP da AWS precisam ser medidos de outro IP. Custo zero: nunca chama Bright Data nem Firecrawl.
 *
 * Env:
 *   RECON_REQS  — JSON: [{ "chave": "bsp-n1", "url": "https://…", "form": { "acaoDest": "N", "pag": "2" },
 *                          "json": { … }, "headers": { … }, "contar": ["regex", …] }]
 *                 `form` → POST application/x-www-form-urlencoded; `json` → POST application/json; senão GET.
 *   RECON_DUMP  — '1' grava o corpo (até 400 KB) em recon_dump.
 *   VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY — só para o dump.
 */
import './lib/env-runner.mjs';
import { decodificarHtml } from './lib/motor/fetch-fonte.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const reqs = JSON.parse(process.env.RECON_REQS || '[]');
const DUMP = process.env.RECON_DUMP === '1';
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;

async function buscar(r) {
  const opts = { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,application/xhtml+xml,application/json', ...(r.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(30000) };
  if (r.form) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = new URLSearchParams(r.form).toString(); }
  else if (r.json) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(r.json); }
  let res = await fetch(r.url, opts);
  // IIS/Cloudflare que dá 400 a cabeçalho de navegador abre "pelado" (mesmo remédio do motor).
  if (res.status === 400) {
    const pel = { method: opts.method, body: opts.body, headers: opts.body ? { 'Content-Type': opts.headers['Content-Type'] } : {}, signal: AbortSignal.timeout(30000) };
    res = await fetch(r.url, pel);
  }
  const buf = await res.arrayBuffer();
  return { status: res.status, url_final: res.url, corpo: decodificarHtml(buf, res.headers.get('content-type') || '') };
}

async function gravar(chave, conteudo) {
  if (!DUMP || !SB || !SK) return 'sem dump';
  const r = await fetch(`${SB}/rest/v1/recon_dump`, {
    method: 'POST', headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ origem: 'recon-gratis', chave, conteudo }),
  });
  return r.ok ? 'dump ok' : `dump HTTP ${r.status}`;
}

let falhas = 0;
for (const r of reqs) {
  try {
    const { status, url_final, corpo } = await buscar(r);
    const contagens = Object.fromEntries((r.contar || []).map((re) => [re, (corpo.match(new RegExp(re, 'gi')) || []).length]));
    const d = await gravar(r.chave || r.url, { url: r.url, form: r.form || null, status, url_final, len: corpo.length, contagens, html: corpo.slice(0, 400000) });
    console.log(`${r.chave || r.url} · HTTP ${status} · ${corpo.length} chars · ${JSON.stringify(contagens)} · ${d}`);
  } catch (e) {
    falhas++;
    console.log(`${r.chave || r.url} · FALHOU: ${String(e?.cause?.code || e?.message || e).slice(0, 120)}`);
    await gravar(r.chave || r.url, { url: r.url, erro: String(e?.cause?.code || e?.message || e).slice(0, 300) }).catch(() => {}); // padrao-ok: o motivo já foi impresso acima
  }
  await new Promise((s) => setTimeout(s, 700));
}
console.log(`fim · ${reqs.length} pedido(s) · ${falhas} falha(s) de rede`);
