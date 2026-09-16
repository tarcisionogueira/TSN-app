// TEMPORÁRIO — recon do FERNANDOLEILOEIRO via Bright Data. Confirmado: Cloudflare Managed
// Challenge de verdade (challenges.cloudflare.com no CSP) — nem Chromium real de datacenter
// resolve (testado, 3 rotas, 12s de espera cada, sempre "Um momento…"). Aprovado pelo dono:
// Bright Data com freio residencial depois. proposito='recon' (sub-cota barata, não disputa
// orçamento de produção).
import './lib/env-runner.mjs';
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';

const BASE = 'https://www.fernandoleiloeiro.com.br';

async function bd(url) {
  try {
    const r = await buscarViaBrightData(url, { proposito: 'recon', timeoutMs: 60000, exigirOk: false });
    if (!r || !r.ok) { console.log(`  ${url} -> não ok (status ${r?.status})`); return null; }
    const buf = await r.arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  } catch (e) {
    console.log(`  ${url} -> ErroBrightData: ${e instanceof ErroBrightData ? e.message : e}`);
    return null;
  }
}

function assinatura(html) {
  const marcas = [];
  if (/cf-mitigated|Just a moment|__CF\$cv\$params|challenge-platform|Um momento/i.test(html)) marcas.push('CLOUDFLARE_CHALLENGE_AINDA');
  if (/static\.suporteleiloes\.com\.br|stats\.suporteleiloes\.com\.br/i.test(html)) marcas.push('SUPORTE_LEILOES(rede)');
  if (/leilao\.php\?idLeilao=/i.test(html)) marcas.push('GESTAO_DE_LEILOES(PHP)');
  if (/offer-query\.superbid\.net|stores\.id/i.test(html)) marcas.push('SUPERBID(rede)');
  return marcas;
}

async function main() {
  let html = null;
  for (const rota of ['/categorias/imoveis', '/imoveis', '/', '/busca']) {
    console.log(`\n=== ${BASE}${rota} via Bright Data ===`);
    const h = await bd(`${BASE}${rota}`);
    if (!h) continue;
    console.log(`HTML: ${h.length} bytes · marcas: [${assinatura(h).join(', ') || 'nenhuma'}]`);
    if (!/Um momento|challenge-platform/i.test(h)) { html = h; break; }
    console.log('  ainda em challenge, tentando próxima rota...');
  }
  if (!html) { console.log('\nTodas as rotas ficaram em challenge.'); return; }

  // Achou "IMÓVEIS" no menu (icon-svg-imoveis) mas sem ID_Categoria ao lado — a própria
  // página /categorias/imoveis pode já SER a listagem. Procura cards/links de LOTE.
  console.log('\n--- <a href> que parecem lote (com número/id, até 50) ---');
  const vistos = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const h = m[1];
    if (vistos.has(h)) continue;
    if (/\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(h)) continue;
    if (/facebook|google|bing|analytics|criar-conta|login|usuario|cadastr/i.test(h)) continue;
    vistos.add(h); console.log(`  ${h}`); if (vistos.size >= 50) break;
  }
  console.log(`\n--- Amostra de texto perto de "R$" (indica card de lote, até 8) ---`);
  let n2 = 0;
  const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const m of txt.matchAll(/.{0,60}R\$\s*[\d.,]+.{0,60}/g)) {
    if (n2 >= 8) break;
    console.log(`  …${m[0].trim()}…`);
    n2++;
  }
}
main();
