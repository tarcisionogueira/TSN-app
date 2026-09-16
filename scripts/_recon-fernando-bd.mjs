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

  // Plataforma "Sua Plataforma de Leilão / Degrau Publicidade" — menu usa
  // /busca/#Engine=Start&...&ID_Categoria=N. Extrai LABEL + ID de cada link de categoria.
  console.log('\n--- Links de categoria (label + ID_Categoria) ---');
  for (const m of html.matchAll(/<a[^>]+href=["'][^"']*ID_Categoria=(\d+)["'][^>]*>([\s\S]{0,60}?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (label) console.log(`  ID_Categoria=${m[1]} -> "${label}"`);
  }
  console.log('\n--- Qualquer texto perto de "imov" no HTML (até 10 janelas) ---');
  let n = 0;
  for (const m of html.matchAll(/.{0,50}imov[eé]i?s?.{0,50}/gi)) {
    if (n >= 10) break;
    console.log(`  …${m[0].replace(/\s+/g, ' ').trim()}…`);
    n++;
  }
  console.log('\n--- <a href> únicos que mencionam categoria/busca (até 40) ---');
  const vistos = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const h = m[1];
    if (vistos.has(h) || !/categoria|busca|imov|leilao/i.test(h)) continue;
    vistos.add(h); console.log(`  ${h}`); if (vistos.size >= 40) break;
  }
}
main();
