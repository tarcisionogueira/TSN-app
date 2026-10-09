/**
 * Recon PONTUAL (09/10, #38) — plataforma Leiloar "/externo/" com o modelo `listagem-bens-responsivo`
 * (osvaldo, sanches, judhastas…). Diferente da Uberlândia (motor scraper-leiloar.mjs), a página do
 * leilão NÃO lista lotes no HTML. Aqui: envia a PESQUISA AVANÇADA e o formulário do leilão
 * (BemIndexForm) num navegador real e imprime os links /externo/lote/<id> que aparecerem + a página
 * de um lote. Sanches não tem desafio Cloudflare para IP do GitHub (osvaldo tem). NÃO grava nada.
 */
import puppeteer from 'puppeteer';

const BASE = 'https://www.sanchesleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const limpa = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setUserAgent(UA);
page.on('response', async (r) => {
  const t = r.request().resourceType();
  if (!['xhr', 'fetch', 'document'].includes(t) || /cdn-cgi|cloudflare/.test(r.url())) return;
  try { const x = await r.text(); console.log(`   <${t} ${r.request().method()} ${r.status()}> ${r.url()} ${r.request().postData() ? `body=${limpa(r.request().postData(), 300)}` : ''} (${x.length}b)`); } catch { /* recon */ }
});
const lotes = async (rot) => {
  const l = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /\/externo\/lote\/\d+/.test(h)))]);
  console.log(`  [${rot}] links de lote (${l.length}): ${l.slice(0, 20).join(' ')}`);
  const txt = await page.evaluate(() => document.body.innerText);
  console.log(`  [${rot}] texto: ${limpa(txt.slice(txt.search(/LEIL[ÕO]ES ATUAIS|PESQUISA AVAN/i)), 1500)}`);
  return l;
};
try {
  console.log('\n═══ 1) leilão 2255 → submit BemIndexForm vazio');
  await page.goto(`${BASE}/externo/leilao/2255`, { waitUntil: 'networkidle2', timeout: 60000 });
  await lotes('leilão GET');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}), page.evaluate(() => document.querySelector('#BemIndexForm')?.submit())]);
  let achados = await lotes('leilão POST');

  console.log('\n═══ 2) pesquisa avançada → categoria imóveis (todos) → PESQUISAR');
  await page.goto(`${BASE}/externo/bens/pesquisaAvancada`, { waitUntil: 'networkidle2', timeout: 60000 });
  const form = await page.evaluate(() => {
    const f = document.querySelector('form[action*="pesquisa"], form#BemPesquisaAvancadaForm, form');
    return f ? { action: f.action, method: f.method, campos: [...f.querySelectorAll('input,select')].map((e) => `${e.name}=${e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? e.value : '') : e.value}`).filter((s) => !s.endsWith('=')).slice(0, 40) } : null;
  });
  console.log(`  form: ${JSON.stringify(form)}`);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}), page.evaluate(() => (document.querySelector('form[action*="pesquisa"]') || document.querySelector('form'))?.submit())]);
  achados = achados.concat(await lotes('pesquisa POST'));

  const alvo = achados[0];
  if (alvo) {
    console.log(`\n═══ 3) LOTE ${alvo}`);
    await page.goto(alvo, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log(`  texto: ${limpa(await page.evaluate(() => document.body.innerText), 3000)}`);
    const html = await page.content();
    const i = html.search(/avalia/i);
    console.log(`  html avaliação: ${limpa(html.slice(Math.max(0, i - 400), i + 1500), 1900)}`);
    console.log(`  fotos: ${(await page.evaluate(() => [...new Set([...document.querySelectorAll('img, a[href]')].map((e) => e.src || e.href).filter((s) => /bem_foto|arquivos\//.test(s || '')))].slice(0, 12))).join(' ')}`);
  }
} catch (e) { console.log(`ERRO: ${e.message}`); }
await browser.close();
