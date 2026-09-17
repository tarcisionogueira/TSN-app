#!/usr/bin/env node
/**
 * RECON — joserodovalholeiloes.com.br e hdleiloes.com.br via PUPPETEER real (não Bright
 * Data): o Web Unlocker (fetch cru) não achou nenhum sinal de lote (m²/matrícula/nº) em
 * `/leilao/index/imoveis` nas duas — mas o HTML tem só o menu, sem cookie-consent nem
 * challenge, o que é a assinatura clássica de listagem carregada por JS/AJAX DEPOIS do
 * load. Puppeteer executa o JS de verdade e é GRÁTIS (mesmo caminho do LJUD/MEGA) — testa
 * essa hipótese antes de gastar Bright Data ou concluir "vazio" sem ter certeza.
 *
 * Roda no GitHub Actions. Sem secrets além dos já usados pelos outros recons.
 */
import puppeteer from 'puppeteer';

const ALVOS = [
  'https://joserodovalholeiloes.com.br/leilao/index/imoveis',
  'https://hdleiloes.com.br/leilao/index/imoveis',
];
const RE_ANCORA = /\bm[²2]\b|lote\s*n?[ºo°]?\s*\d|matr[íi]cula|R\$\s?[\d.,]+/i;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  for (const url of ALVOS) {
    console.log(`\n=== ${url} ===`);
    const page = await browser.newPage();
    const chamadasXhr = [];
    const respostasApi = [];
    page.on('request', (req) => {
      const t = req.resourceType();
      if (t === 'xhr' || t === 'fetch') chamadasXhr.push(req.url());
    });
    page.on('response', async (res) => {
      const u = res.url();
      if (/\/core\/api\/get-leiloes/.test(u)) {
        try {
          const txt = await res.text();
          respostasApi.push({ url: u, status: res.status(), corpo: txt.slice(0, 2500) });
        } catch { /* padrao-ok: corpo pode já ter sido consumido/fechado pelo browser — best-effort, só recon */ }
      }
    });
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(`  goto: status=${resp?.status() ?? '(sem response)'}`);
      // Espera extra — alguns front-ends disparam o fetch da listagem só após um pequeno
      // atraso ou scroll; 3s é barato e evita falso-negativo por ansiedade.
      await new Promise((r) => setTimeout(r, 3000));
      const html = await page.content();
      console.log(`  HTML renderizado: ${html.length} bytes`);
      if (chamadasXhr.length) console.log(`  chamadas XHR/fetch vistas: ${JSON.stringify(chamadasXhr.slice(0, 15))}`);
      else console.log('  nenhuma chamada XHR/fetch vista — a página não busca dado nenhum por AJAX.');
      for (const r of respostasApi) console.log(`  RESPOSTA ${r.url} (HTTP ${r.status}): ${JSON.stringify(r.corpo)}`);
      const idx = html.search(RE_ANCORA);
      if (idx >= 0) {
        console.log(`  ÂNCORA ACHADA após render! trecho: ${JSON.stringify(html.slice(Math.max(0, idx - 400), idx + 400))}`);
      } else {
        console.log('  ainda sem âncora de lote mesmo depois do JS rodar — provável 0 lotes ativos nesta categoria agora.');
      }
      // Lista requisições de rede que pareçam API de listagem, pra registrar o endpoint
      // real caso alguém queira reconstruir via fetch direto depois.
    } catch (e) {
      console.log(`  erro: ${e.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  await browser.close();
})();
