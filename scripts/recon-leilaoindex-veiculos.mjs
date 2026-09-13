#!/usr/bin/env node
/**
 * RECON — antes de escrever o scraper de veículo do vendor "leilao/index" (13/09,
 * RIGOLONLEILOES/GIORDANOLEILOES/THAISTEIXEIRA). O fingerprint já confirmado (ver
 * scripts/lib/leilaoindex-parse.mjs) inclui `/leilao/index/veiculos` como path irmão de
 * `/leilao/index/imoveis` — mas a MESMA plataforma já ensinou, no imóvel, que um path que
 * "deveria" existir pode dar 400 (erro da própria aplicação) e o catálogo real estar só na
 * home (`/`). Não repete esse chute pro lado do veículo: visita os dois (`/` e
 * `/leilao/index/veiculos`) nos 3 tenants, conta quantos links batem no padrão de lote
 * (`/leilao/index/leilao_id/<id>/lote/<id2>`), e imprime as 6 primeiras linhas de texto
 * renderizado de até 2 detalhes por tenant — é onde mora o rótulo "Tipo do bem" que pode
 * classificar carro/moto/caminhão sem inferência nossa (mesmo princípio já usado no
 * Suporte: "Tipo Judicial/Extrajudicial" é rótulo do leiloeiro, não regex adivinhando).
 * Só leitura, não grava nada.
 *
 * Uso: node scripts/recon-leilaoindex-veiculos.mjs
 */
import puppeteer from 'puppeteer';
import { TENANTS, extrairUrlsDeLote } from './lib/leilaoindex-parse.mjs';
import { textoComLinhas } from './lib/dom-parse-util.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function visitar(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    return await page.content();
  } catch (e) {
    console.log(`    erro ao visitar ${url}: ${String(e?.message || e).slice(0, 120)}`);
    return '';
  }
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const tenant of Object.values(TENANTS)) {
      console.log(`\n════ ${tenant.fonte} (${tenant.base}) ════`);
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
      try {
        for (const caminho of ['/leilao/index/veiculos', '/']) {
          const url = `${tenant.base}${caminho}`;
          const html = await visitar(page, url);
          const urls = html ? extrairUrlsDeLote(html, tenant.base) : new Map();
          console.log(`  [${caminho}] ${urls.size} link(s) de lote encontrados`);
          if (urls.size) {
            const amostra = [...urls.values()].slice(0, 3);
            for (const u of amostra) console.log(`      ${u}`);
          }
          // Achou lote em '/leilao/index/veiculos' — não precisa cair pra home também.
          if (caminho === '/leilao/index/veiculos' && urls.size) break;
        }
      } finally { /* segue pro detalhe usando a mesma page */ }

      // Detalhe de até 2 lotes achados (qualquer um dos dois caminhos acima) — pra ver o
      // formato real da 1ª linha (onde mora "Tipo do bem" nos imóveis desta plataforma).
      const htmlListagem = await visitar(page, `${tenant.base}/leilao/index/veiculos`);
      const urls = [...extrairUrlsDeLote(htmlListagem, tenant.base).values()];
      const fallback = urls.length ? urls : [...extrairUrlsDeLote(await visitar(page, tenant.base), tenant.base).values()];
      for (const url of fallback.slice(0, 2)) {
        console.log(`  ── detalhe: ${url}`);
        const htmlDet = await visitar(page, url);
        if (!htmlDet) continue;
        const linhas = textoComLinhas(htmlDet).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8);
        linhas.forEach((l, i) => console.log(`      [${i}] ${l.slice(0, 140)}`));
      }
      await page.close().catch(() => {});
    }
  } finally { await browser.close(); }
  console.log('\n✅ Recon concluído.');
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
