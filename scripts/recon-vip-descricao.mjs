/**
 * RECON (só leitura, não grava) — por que 0 de 144 lotes VIP ativos têm descrição (#141).
 *
 * O enriquecimento já visita a página do lote quando a descrição é eco do título e roda
 * `extrairDescricaoDoCorpo` no HTML. Duas hipóteses, e elas pedem consertos diferentes:
 *  (a) o extrator NÃO acha a descrição na página do VIP (estrutura/aba carregada por JS);
 *  (b) acha, mas o upsert diário do card regrava o eco do título por cima (o merge do banco
 *      não carrega `descricao`).
 * Este recon responde (a) na página viva: roda o MESMO extrator e mostra onde o texto mora.
 */
import puppeteer from 'puppeteer';
import { extrairDescricaoDoCorpo } from '../api/_texto-imovel.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const URLS = (process.env.RECON_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const url of URLS) {
    console.log(`\n═══ ${url}`);
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    try {
      const t0 = Date.now();
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(`  HTTP ${resp?.status()} em ${Date.now() - t0} ms`);
      const html = await page.content();
      const desc = extrairDescricaoDoCorpo(html);
      console.log(`  extrairDescricaoDoCorpo: ${desc ? `${desc.length} chars — ${JSON.stringify(desc.slice(0, 400))}` : 'NULL'}`);
      const d = await page.evaluate(() => {
        const txt = (document.body.innerText || '').replace(/[ \t]+/g, ' ');
        const i = txt.search(/descri[çc][ãa]o|detalhes do (?:im[óo]vel|lote)|observa[çc][õo]es/i);
        return {
          tam: txt.length,
          trecho: i >= 0 ? txt.slice(Math.max(0, i - 100), i + 1500) : txt.slice(0, 1500),
          abas: [...document.querySelectorAll('[role=tab], .nav-tabs a, .nav-link, button')].map((e) => (e.textContent || '').trim()).filter((s) => s && s.length < 40).slice(0, 25),
          titulos: [...document.querySelectorAll('h1,h2,h3,h4')].map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 20),
        };
      });
      console.log(`  innerText: ${d.tam} chars`);
      console.log(`  títulos: ${JSON.stringify(d.titulos)}`);
      console.log(`  abas/botões: ${JSON.stringify(d.abas)}`);
      console.log(`  trecho: ${JSON.stringify(d.trecho)}`);
    } catch (e) {
      console.log(`  ERRO: ${String(e.message).slice(0, 160)}`);
    } finally { await page.close().catch(() => {}); }
  }
} finally { await browser.close(); }
