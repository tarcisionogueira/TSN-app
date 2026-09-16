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
  for (const rota of ['/categorias/imoveis', '/imoveis', '/']) {
    console.log(`\n=== ${BASE}${rota} via Bright Data ===`);
    const html = await bd(`${BASE}${rota}`);
    if (!html) continue;
    console.log(`HTML: ${html.length} bytes · marcas: [${assinatura(html).join(', ') || 'nenhuma'}]`);
    if (!/Um momento|challenge-platform/i.test(html)) {
      // Passou! Procura URLs de lote no padrão conhecido + qualquer coisa que pareça oferta.
      const lotesJE = [...html.matchAll(/href=["']([^"']*\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?(\d+)\/[a-z0-9-]+)\/?["']/gi)];
      console.log(`URLs padrão JELEILOES: ${lotesJE.length}`);
      console.log('\n--- <a href> únicos (até 30) ---');
      const vistos = new Set();
      for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
        const h = m[1];
        if (vistos.has(h) || /\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(h)) continue;
        vistos.add(h); console.log(`  ${h}`); if (vistos.size >= 30) break;
      }
      console.log('\n--- HTML cru (primeiros 2000 chars) ---');
      console.log(html.slice(0, 2000));
      break;
    } else {
      console.log('  ainda em challenge, tentando próxima rota...');
    }
  }
}
main();
