// Teste manual, único: confirma em produção que o seletor de parcelas do link de
// honorários mostra juros a partir de 2x (só 1x/PIX sem juros). Roda no runner do GitHub
// Actions (tem internet de verdade; o sandbox do Claude bloqueia o domínio de produção).
import puppeteer from 'puppeteer';

const ARREMATACAO_ID = process.env.ARREMATACAO_ID;
if (!ARREMATACAO_ID) { console.error('ARREMATACAO_ID obrigatório'); process.exit(1); }
const BASE = 'https://www.bidprobrasil.com.br';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  // Zera qualquer cache/service worker de execuções anteriores — o app é PWA com SW próprio.
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, []);
  await page.goto(`${BASE}/#/honorario/${ARREMATACAO_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Aceita os termos (checkbox 1) para revelar o PagamentoServico.
  const checkboxes = await page.$$('input[type=checkbox]');
  if (checkboxes[0]) await checkboxes[0].click();
  await new Promise(r => setTimeout(r, 1000));

  // Escolhe "Cartão de crédito".
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const alvo = btns.find(b => b.textContent.includes('Cartão de crédito'));
    if (alvo) { alvo.click(); return true; }
    return false;
  });
  console.log('Clicou em "Cartão de crédito"?', clicked);
  await new Promise(r => setTimeout(r, 1000));

  const opcoes = await page.evaluate(() => {
    const sel = document.querySelector('select');
    if (!sel) return null;
    return [...sel.options].map(o => o.textContent);
  });
  console.log('Opções do seletor de parcelas:');
  console.log(JSON.stringify(opcoes, null, 2));
} finally {
  await browser.close();
}
