// TEMPORÁRIO — por que JOAOEMILIO (SOLEON) enumerou 0 lotes mesmo via Bright Data (28KB)?
// Dumpa o texto da página pra ver se é challenge, "sem resultado", ou estrutura de URL nova.
import './lib/env-runner.mjs';
import { buscarViaBrightData } from '../api/_brightdata.js';

const BASE = 'https://www.joaoemilio.com.br';

async function main() {
  for (const rota of ['/lotes/imovel', '/', '/lotes', '/leiloes']) {
    console.log(`\n=== ${BASE}${rota} ===`);
    try {
      const r = await buscarViaBrightData(`${BASE}${rota}`, { proposito: 'recon', timeoutMs: 40000, exigirOk: false });
      if (!r) { console.log('  sem resposta'); continue; }
      const buf = await r.arrayBuffer();
      const html = new TextDecoder('utf-8').decode(buf);
      console.log(`  status=${r.status} bytes=${html.length}`);
      const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`  texto (900): ${txt.slice(0, 900)}`);
      const hrefs = [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map(m => m[1]))].filter(h => /lote|item|imov|leilao|leil[aã]o/i.test(h)).slice(0, 20);
      console.log(`  hrefs relevantes (${hrefs.length}): ${JSON.stringify(hrefs)}`);
    } catch (e) {
      console.log(`  erro: ${e.message}`);
    }
  }
}
main();
