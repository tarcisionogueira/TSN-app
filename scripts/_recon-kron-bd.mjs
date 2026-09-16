// TEMPORÁRIO — recon do KRONLEILOES via Bright Data (Cloudflare confirmado bloqueando fetch
// direto). Aprovado pelo dono: implementar via Bright Data, freio residencial depois (só roda
// pago se o residencial não coletar em 7 dias — mesmo padrão do GESTAOLEILOES).
// proposito='recon' (sub-cota já provisionada, teto 80/semana, barata) — não usa a cota de
// produção de nenhuma fonte.
import './lib/env-runner.mjs';
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';

const BASE = 'https://kronleiloes.com.br';

function assinatura(html) {
  const marcas = [];
  if (/static\.suporteleiloes\.com\.br|stats\.suporteleiloes\.com\.br/i.test(html)) marcas.push('SUPORTE_LEILOES(rede)');
  if (/leilao\.php\?idLeilao=/i.test(html)) marcas.push('GESTAO_DE_LEILOES(PHP)');
  if (/window\.__NUXT__|_next\/static|__NEXT_DATA__/i.test(html)) marcas.push('SPA(NUXT/NEXT)');
  return marcas;
}

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

async function main() {
  console.log('=== Home via Bright Data ===');
  const home = await bd(`${BASE}/imoveis`);
  if (!home) { console.log('home não veio'); return; }
  console.log(`HTML: ${home.length} bytes · marcas: [${assinatura(home).join(', ') || 'nenhuma'}]`);

  const lotes = [...home.matchAll(/href=["']([^"']*\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?(\d+)\/[a-z0-9-]+)\/?["']/gi)];
  console.log(`URLs padrão JELEILOES/KLEILOES: ${lotes.length}`);
  for (const m of lotes.slice(0, 5)) console.log(`  ${m[1]}`);

  if (!lotes.length) {
    console.log('\n--- Todos os <a href> (até 40, sem filtro) ---');
    const vistos = new Set();
    for (const m of home.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
      const h = m[1];
      if (vistos.has(h) || /\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(h)) continue;
      vistos.add(h); console.log(`  ${h}`); if (vistos.size >= 40) break;
    }
    console.log('\n--- Assinaturas de SPA/framework ---');
    console.log('  id="app" vazio:', /<div id=["']app["']>\s*<\/div>/i.test(home));
    console.log('  id="root" vazio:', /<div id=["']root["']>\s*<\/div>/i.test(home));
    console.log('  Vue:', /vue(\.min)?\.js|__VUE__|v-cloak/i.test(home));
    console.log('  React:', /react-dom|__NEXT_DATA__/i.test(home));
    console.log('  Angular:', /ng-app|angular\.js/i.test(home));
    console.log('  buscador/categoria=2 mencionado:', /buscador\?categoria=2|buscador%3fcategoria%3d2/i.test(home));
    console.log('\n--- HTML CRU (primeiros 3000 chars, sem strip) ---');
    console.log(home.slice(0, 3000));
    console.log('\n--- HTML CRU (últimos 1500 chars) ---');
    console.log(home.slice(-1500));
    return;
  }

  const url1 = new URL(lotes[0][1], BASE).href;
  console.log(`\n=== Detalhe via Bright Data: ${url1} ===`);
  const det = await bd(url1);
  if (!det) return;
  console.log(`HTML: ${det.length} bytes`);
  console.log('tem <table> com Valor de Avaliação:', /<table[\s\S]*?Valor\s+de\s+Avalia[çc][ãa]o[\s\S]*?<\/table>/i.test(det));
  console.log('tem Lance Inicial:', /Lance\s+Inicial/i.test(det));
  console.log('tem Valor Inicial:', /Valor\s+Inicial/i.test(det));
  console.log('--- linhas de tabela ---');
  for (const tr of det.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cols = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) =>
      td[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim());
    if (cols.some((c) => c)) console.log('  [' + cols.join(' | ') + ']');
  }
  console.log('--- links .pdf ---');
  for (const m of det.matchAll(/<a[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    console.log(`  pdf: ${m[1]} · label: ${m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
  }
  console.log('--- onClick=anexoCarregar ---');
  for (const m of det.matchAll(/<a[\s\S]*?anexoCarregar\((['"])([^'"]+)\1\)[\s\S]*?>([\s\S]*?)<\/a>/gi)) {
    console.log(`  anexoCarregar: ${m[2]} · label: ${m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
  }
}
main();
