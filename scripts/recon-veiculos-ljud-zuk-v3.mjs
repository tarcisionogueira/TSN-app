/**
 * RECON v3 — mais uma tentativa em LJUD e Zuk, com abordagem mais próxima de navegação
 * humana (a v2 já tinha acertado o MÉTODO certo pra LJUD — POST no navegador — mas ainda
 * não achou o `tipo=` de veículo; a Zuk bateu num desafio Cloudflare que pode ter sido
 * pontual, já que a MESMA fonte coleta 729 imóveis normalmente todo dia com essa exata
 * abordagem).
 *
 * - Zuk: visita a HOME primeiro (estabelece cookies/sessão, como faria uma pessoa
 *   navegando), só depois vai para /leilao-de-veiculos — e tenta 2x com pausa.
 * - LJUD: em vez de adivinhar `tipo=`, procura no HTML da própria home (ou de um menu)
 *   um link para alguma seção de veículo, e também tenta `categoria=` em vez de `tipo=`
 *   (a querystring tem os dois parâmetros; talvez o que separa imóvel de veículo seja
 *   `categoria`, não `tipo`, e o comentário do código-fonte estivesse errado sobre qual
 *   controla o quê). Também loga o corpo CRU da resposta pra eu ler o que realmente vem.
 *
 * Uso: node scripts/recon-veiculos-ljud-zuk-v3.mjs
 */
import puppeteer from 'puppeteer';

async function reconZuk(browser, log) {
  log('\n════ PortalZuk v3 — home primeiro, depois /leilao-de-veiculos (2 tentativas) ════');
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.portalzuk.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));
    log(`  título da home: ${await page.title()}`);
    // Procura o link de veículos no MENU da própria home — mais confiável que adivinhar a URL.
    const linkMenu = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href]')].find(el => /ve[ií]culo/i.test(el.textContent || '') || /veiculo/i.test(el.getAttribute('href') || ''));
      return a ? a.href : null;
    });
    log(`  link de veículos encontrado no menu da home: ${linkMenu}`);

    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      await new Promise(r => setTimeout(r, 2500));
      await page.goto(linkMenu || 'https://www.portalzuk.com.br/leilao-de-veiculos', { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 2500));
      const info = await page.evaluate(() => ({
        titulo: document.title,
        temCloudflare: /cloudflare|attention required/i.test(document.title + ' ' + (document.body.innerText || '').slice(0, 200)),
        cardProperty: document.querySelectorAll('.card-property').length,
      }));
      log(`  tentativa ${tentativa}: título="${info.titulo}" cloudflare=${info.temCloudflare} .card-property=${info.cardProperty}`);
      if (!info.temCloudflare && info.cardProperty > 0) { log('  ✅ passou desta vez — sem desafio, cards presentes'); break; }
    }
  } catch (e) { log(`  erro: ${String(e?.message || e).slice(0, 150)}`); }
  finally { await page.close().catch(() => {}); } // padrao-ok: fechar página best-effort em script de recon
}

async function reconLJUD(browser, log) {
  log('\n════ LJUD v3 — categoria= no lugar de tipo=, e corpo cru da resposta ════');
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.leiloesjudiciais.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));
    // Procura link de veículo no menu da própria home.
    const linkMenu = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href]')].find(el => /ve[ií]culo/i.test(el.textContent || '') || /veiculo/i.test(el.getAttribute('href') || ''));
      return a ? a.href : null;
    });
    log(`  link de veículos encontrado no menu da home: ${linkMenu}`);

    for (const [nomeParam, valores] of [['categoria', [1, 2, 4, 5]], ['tipo', [3]]]) {
      for (const v of valores) {
        const qs = nomeParam === 'categoria'
          ? `tipo=3&categoria=${v}&estado=0&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=0&lote_id=0&ordenacao=null`
          : `tipo=${v}&categoria=0&estado=0&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=0&lote_id=0&ordenacao=null`;
        const url = `https://api.leiloesjudiciais.com.br/core/api/get-lotes?pg=1&qtd_por_pagina=5&${qs}`;
        const data = await page.evaluate(async (u) => {
          try {
            const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            const txt = await r.text();
            return { status: r.status, txt: txt.slice(0, 500) };
          } catch (e) { return { erro: String((e && e.message) || e) }; } // padrao-ok: recon best-effort, retorno reportado no log logo abaixo
        }, url);
        log(`  [${nomeParam}=${v}] status=${data.status ?? data.erro} corpo="${data.txt}"`);
      }
    }
  } catch (e) { log(`  erro geral: ${String(e?.message || e).slice(0, 150)}`); }
  finally { await page.close().catch(() => {}); } // padrao-ok: fechar página best-effort em script de recon
}

async function main() {
  const log = (s) => console.log(s);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    await reconZuk(browser, log);
    await reconLJUD(browser, log);
  } finally { await browser.close(); }
  log('\n✅ Recon v3 concluído.');
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
