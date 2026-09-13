/**
 * RECON v2 — LJUD e Zuk. A v1 (recon-veiculos-4fontes.mjs) confirmou Mega e WebLeilões, mas
 * errou a abordagem nos outros dois:
 * - LJUD: testei `tipo=` via GET puro do Node — a API respondeu "Metodo não permitido" pros
 *   5 valores. O scraper real (scraperLJUD_navegador, linha ~2178) usa POST com body '{}',
 *   de DENTRO do navegador (fetch no contexto da página, depois de visitar a home primeiro)
 *   — replica isso aqui, testando `tipo=` por esse caminho certo.
 * - Zuk: `.card-property` deu 0 na página de veículos — dumpa a estrutura real da página
 *   (classes mais frequentes, hrefs presentes) em vez de continuar chutando seletor.
 *
 * Uso: node scripts/recon-veiculos-ljud-zuk.mjs
 */
import puppeteer from 'puppeteer';

async function reconLJUD(browser, log) {
  log('\n════ LJUD — testando `tipo=` via POST, no contexto do navegador (como o scraper real) ════');
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.leiloesjudiciais.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));
    for (const endpoint of ['get-lotes', 'get-bens-por-estados']) {
      for (const tipo of [1, 2, 4, 5, 6]) {
        const url = `https://api.leiloesjudiciais.com.br/core/api/${endpoint}?pg=1&qtd_por_pagina=5&tipo=${tipo}&categoria=0&estado=0&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=0&lote_id=0&ordenacao=null`;
        const data = await page.evaluate(async (u) => {
          try {
            const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            const txt = await r.text();
            return { status: r.status, txt: txt.slice(0, 400) };
          } catch (e) { return { erro: String((e && e.message) || e) }; } // padrao-ok: recon best-effort, retorno reportado no log logo abaixo
        }, url);
        let itens = null, titulo1 = null, categoria1 = null;
        try {
          const j = JSON.parse(data.txt || '{}');
          const arr = j.items || j.data || (Array.isArray(j) ? j : []);
          itens = Array.isArray(arr) ? arr.length : null;
          titulo1 = arr?.[0]?.nm_titulo_lote || arr?.[0]?.nm_titulo_leilao || null;
          categoria1 = arr?.[0]?.nm_categoria || arr?.[0]?.id_categoria || null;
        } catch {} // padrao-ok: recon best-effort — resposta não-JSON só significa que itens fica null, reportado como tal
        log(`  [${endpoint}] tipo=${tipo}: status=${data.status ?? data.erro} itens=${itens} 1º título="${titulo1}" categoria="${categoria1}"`);
      }
    }
  } catch (e) { log(`  erro geral: ${String(e?.message || e).slice(0, 150)}`); }
  finally { await page.close().catch(() => {}); } // padrao-ok: fechar página best-effort em script de recon
}

async function reconZuk(browser, log) {
  log('\n════ PortalZuk — dump de estrutura de /leilao-de-veiculos ════');
  const page = await browser.newPage();
  try {
    await page.goto('https://www.portalzuk.com.br/leilao-de-veiculos', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));
    const info = await page.evaluate(() => {
      // Classes mais frequentes entre 5 e 60 chars (filtra utilitárias tipo "row"/"col-12")
      // que aparecem em pelo menos 3 elementos — candidatas a "card de item".
      const contagem = {};
      document.querySelectorAll('[class]').forEach((el) => {
        el.className.toString().split(/\s+/).forEach((c) => {
          if (c.length < 4 || c.length > 40) return;
          contagem[c] = (contagem[c] || 0) + 1;
        });
      });
      const candidatas = Object.entries(contagem)
        .filter(([, n]) => n >= 3 && n <= 200)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25);
      const hrefs = [...document.querySelectorAll('a[href]')]
        .map((a) => a.href)
        .filter((h) => /portalzuk\.com\.br\/(?!leilao-de-veiculos$)/.test(h));
      const hrefsUnicos = [...new Set(hrefs)].slice(0, 15);
      return {
        totalElementosComClasse: document.querySelectorAll('[class]').length,
        candidatasClasse: candidatas,
        amostraHrefs: hrefsUnicos,
        tituloPagina: document.title,
        temTextoSemResultado: /nenhum|sem resultado|não encontr/i.test(document.body.innerText || ''),
      };
    });
    log(`  título da página: ${info.tituloPagina}`);
    log(`  parece dizer "sem resultado"?: ${info.temTextoSemResultado}`);
    log(`  classes candidatas (nome: ocorrências): ${JSON.stringify(info.candidatasClasse)}`);
    log(`  amostra de hrefs de item na página: ${JSON.stringify(info.amostraHrefs, null, 0)}`);
  } catch (e) { log(`  erro: ${String(e?.message || e).slice(0, 150)}`); }
  finally { await page.close().catch(() => {}); } // padrao-ok: fechar página best-effort em script de recon
}

async function main() {
  const log = (s) => console.log(s);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    await reconLJUD(browser, log);
    await reconZuk(browser, log);
  } finally { await browser.close(); }
  log('\n✅ Recon v2 concluído.');
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
