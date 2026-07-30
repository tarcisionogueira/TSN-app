// Teste MÍNIMO do Chromium residencial (diagnóstico do runner de casa):
//   node scripts/teste-chromium.mjs [url]
// Abre 1 página pelo mesmo caminho dos scrapers GESTAO/RJ e diz se o HTML veio.
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';

const url = process.argv[2] || 'https://www.granadoleiloes.com.br/';
console.log(`Abrindo ${url} no Chromium headless…`);
const h = await fetchHeadless(url, { timeoutMs: 60000 });
if (h) {
  console.log(`✅ OK: ${h.length} bytes de HTML.`);
  const m = h.match(/<title[^>]*>([^<]{0,120})/i);
  if (m) console.log(`   título da página: ${m[1].trim()}`);
} else {
  console.log('❌ FALHOU — o motivo está na linha [headless] acima.');
}
await fecharHeadless();
