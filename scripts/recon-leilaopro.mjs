import { fetchUnlockerContado } from './lib/bd-ledger.mjs';
/**
 * Recon RUNTIME — plataforma "LeilãoPro Core" (leffaleiloes / oscarleiloes)
 * ========================================================================
 * Backlog aponta fingerprint `/leilaoprocore/js/` e listagem `/leilao/lotes/imoveis`.
 * Aqui CONFIRMAMOS a estrutura VIVA antes de codar o scraper (lição emiliomatos:
 * fingerprint de HTML ≠ contrato de API). Baixa via Bright Data:
 *   1) home  → detecta SSR (lotes embutidos) vs SPA (só shell)
 *   2) /leilao/lotes/imoveis (+ variações de paginação) → HTML de lotes? JSON?
 *   3) bundles /leilaoprocore/js/*.js → extrai endpoints candidatos
 * NÃO grava nada. Ler o log do Actions e então codar o parser.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const TENANTS = (process.env.LEILAOPRO_TENANTS || 'leffaleiloes.com.br,oscarleiloes.com.br').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BUNDLES = 8;

if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bdFetch(url, timeoutMs = 60000) {
  try {
    const r = await fetchUnlockerContado({
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}

function extrairEndpoints(js) {
  const achados = new Set();
  const reStr = /["'`](\/(?:api|core|v1|v2|v3|lotes?|leiloes?|leilao|busca|search|imoveis?|filtro|ajax)[A-Za-z0-9/_\-{}.:?=&]*)["'`]/gi;
  let m;
  while ((m = reStr.exec(js))) achados.add(m[1]);
  const reCall = /(?:axios\.(?:get|post|put)|fetch|\$\.(?:get|post|ajax))\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = reCall.exec(js))) if (/^[\/h]/.test(m[1])) achados.add(m[1]);
  const reBase = /(?:baseURL|apiUrl|api_url|API_URL|url)\s*[:=]\s*["'`](\/[^"'`]+|https?:[^"'`]+)["'`]/gi;
  while ((m = reBase.exec(js))) achados.add('[base] ' + m[1]);
  return [...achados];
}

// Sinais de que a listagem trouxe LOTES de verdade (não só um shell/menu).
function sinaisDeLote(html) {
  const low = html.toLowerCase();
  return {
    reais: (html.match(/R\$\s?[\d.]/g) || []).length,
    lote: (low.match(/\blote\b/g) || []).length,
    card: (low.match(/card-|lote-|property|imovel-|leilao-item/g) || []).length,
    hrefLote: [...html.matchAll(/href=["']([^"']*(?:lote|imovel|leilao\/lotes)[^"']*)["']/gi)].map(x => x[1]).slice(0, 8),
    json: /^\s*[[{]/.test(html.trim()),
    len: html.length,
  };
}

(async () => {
  for (const host of TENANTS) {
    const BASE = 'https://www.' + host;
    console.log(`\n╔══════════════════════════ ${host} ══════════════════════════╗`);
    const home = await bdFetch(BASE + '/');
    console.log(`HOME → HTTP ${home.status}  len=${home.body.length}${home.err ? '  err=' + home.err : ''}`);
    if (/just a moment|cf-challenge|enable javascript/i.test(home.body)) console.log('⚠️ possível desafio Cloudflare no corpo.');
    console.log('  home sinais:', JSON.stringify(sinaisDeLote(home.body)));

    // bundles leilaoprocore
    const assets = [...new Set([...home.body.matchAll(/["']([^"']*leilaoprocore\/js\/[^"']+\.js[^"']*)["']/gi)].map(x => x[1]))];
    console.log(`  bundles leilaoprocore no HTML: ${assets.length}`); assets.slice(0, 12).forEach(a => console.log('     ' + a));

    // listagem documentada + variações de paginação comuns na plataforma
    const rotas = [
      '/leilao/lotes/imoveis',
      '/leilao/lotes/imoveis?pagina=1',
      '/leilao/lotes/imoveis?page=1',
      '/leilao/lotes/imoveis/1',
      '/leiloes/imoveis',
      '/imoveis',
    ];
    for (const rota of rotas) {
      const r = await bdFetch(BASE + rota);
      const s = sinaisDeLote(r.body);
      console.log(`  ${rota} → HTTP ${r.status}  R$×${s.reais}  lote×${s.lote}  card×${s.card}  json=${s.json}  len=${s.len}`);
      if (s.hrefLote.length) s.hrefLote.forEach(h => console.log('       href: ' + h));
    }

    // endpoints dos bundles
    const eps = new Map();
    for (const a of assets.slice(0, MAX_BUNDLES)) {
      const url = a.startsWith('http') ? a : BASE + (a.startsWith('/') ? a : '/' + a);
      const b = await bdFetch(url);
      for (const e of extrairEndpoints(b.body)) {
        if (!eps.has(e)) eps.set(e, 0);
        eps.set(e, eps.get(e) + 1);
      }
    }
    if (eps.size) {
      console.log(`  ── endpoints candidatos (${eps.size}):`);
      [...eps.keys()].sort().forEach(e => console.log('     ' + e));
    }
  }
  console.log('\nDica: alvo = rota de LISTAGEM com paginação que devolve lotes (SSR HTML ou JSON). Ver R$×/lote×/href.');
})();
