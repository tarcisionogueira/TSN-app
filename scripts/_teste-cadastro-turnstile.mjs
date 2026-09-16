// TEMPORÁRIO — abre o cadastro de verdade em produção, preenche os campos (sem enviar) e tira
// print pra confirmar visualmente que o widget do Turnstile aparece e resolve sozinho (modo
// Managed = não-interativo pra maioria dos visitantes).
import puppeteer from 'puppeteer';

const BASE = 'https://www.bidprobrasil.com.br';

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 900 });

  console.log('Abrindo /#/login...');
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle2', timeout: 45000 });

  // A tela abre em modo "entrar" — precisa clicar em "Criar conta grátis" pra ir pro cadastro.
  const criarConta = await page.$$eval('button, a', els =>
    els.find(e => /criar conta/i.test(e.textContent || ''))?.outerHTML || null);
  console.log('botão "criar conta" achado?', !!criarConta);

  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, a')].find(e => /criar conta/i.test(e.textContent || ''));
    if (el) el.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Preenche nome/email/senha pra chegar visualmente perto do botão de submit, onde o widget
  // deveria estar. Não clica em enviar (não queremos criar conta de verdade).
  const preencheu = await page.evaluate(() => {
    const setVal = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    const inputs = [...document.querySelectorAll('input')];
    const porPlaceholder = (re) => inputs.find(i => re.test(i.placeholder || ''));
    let ok = 0;
    const nome = porPlaceholder(/nome/i); if (nome) { setVal(`input[placeholder="${nome.placeholder}"]`, 'Teste Print Widget'); ok++; }
    const email = porPlaceholder(/email/i); if (email) { setVal(`input[placeholder="${email.placeholder}"]`, `teste.print.${Date.now()}@gmail.com`); ok++; }
    return ok;
  });
  console.log('campos preenchidos:', preencheu);

  await new Promise(r => setTimeout(r, 3000)); // dá tempo do Turnstile carregar/resolver

  // Confirma via DOM se o iframe do Turnstile está presente.
  const temTurnstile = await page.evaluate(() => !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'));
  console.log('iframe do Turnstile presente no DOM?', temTurnstile);

  await page.screenshot({ path: 'print-cadastro.png', fullPage: true });
  console.log('print salvo.');

  await browser.close();
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
