// Screenshot manual, único, da tela de pagamento de honorários — roda no runner do GitHub
// Actions (tem internet de verdade; o sandbox do Claude bloqueia o domínio de produção).
import puppeteer from 'puppeteer';

const ARREMATACAO_ID = process.env.ARREMATACAO_ID;
if (!ARREMATACAO_ID) { console.error('ARREMATACAO_ID obrigatório'); process.exit(1); }
const BASE = 'https://www.bidprobrasil.com.br';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 900 });
  await page.goto(`${BASE}/#/honorario/${ARREMATACAO_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const emailInput = await page.$('input[type=email]');
  if (emailInput) await emailInput.type('teste@bidprobrasil.com.br');
  const checkboxes = await page.$$('input[type=checkbox]');
  if (checkboxes[0]) await checkboxes[0].click();
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({ path: 'honorario.png', fullPage: true });
  console.log('Screenshot salvo.');
} finally {
  await browser.close();
}
