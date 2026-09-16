// Teste manual, único, do link de pagamento de honorários SEM sessão logada — roda no
// runner do GitHub Actions (tem internet de verdade; o sandbox do Claude bloqueia o domínio
// de produção). Verifica: (1) /api/honorario-info responde sem Authorization; (2) a SPA
// renderiza a tela de pagamento na rota hash, sem redirecionar para /login.
import puppeteer from 'puppeteer';

const ARREMATACAO_ID = process.env.ARREMATACAO_ID;
if (!ARREMATACAO_ID) { console.error('ARREMATACAO_ID obrigatório'); process.exit(1); }
const BASE = 'https://www.bidprobrasil.com.br';

console.log('--- 1) /api/honorario-info sem Authorization ---');
const r = await fetch(`${BASE}/api/honorario-info?id=${ARREMATACAO_ID}`);
const body = await r.text();
console.log('status:', r.status);
console.log('body:', body);

console.log('\n--- 2) Renderização da SPA (headless, sem cookies) ---');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/#/honorario/${ARREMATACAO_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(res => setTimeout(res, 2500));
  console.log('URL final:', page.url());
  const texto = await page.evaluate(() => document.body.innerText);
  console.log('Texto visível (primeiros 600 chars):');
  console.log(texto.slice(0, 600));
} finally {
  await browser.close();
}
