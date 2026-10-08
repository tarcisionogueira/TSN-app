/**
 * Recon PONTUAL (08/10, #183) — galeria de fotos da VIP (leilaovip.com.br).
 *
 * As fotos de TODOS os lotes ficam no mesmo blob (armazupleilaovipprd.blob.core.windows.net/
 * uploads/<uuid>), então "pegar toda imagem do blob" arriscaria foto de OUTRO lote (carrossel de
 * lotes relacionados). Antes de escrever regra: ver em que contêiner a galeria do lote mora e se
 * há API com a lista. Do sandbox o site é barrado e o pg_net entra em loop de redirect.
 *
 * NÃO grava nada — só imprime.
 */
import puppeteer from 'puppeteer';

const ALVOS = [
  { url: 'https://www.leilaovip.com.br/evento/anuncio/apartamento-com-9791-m-barra-olimpica-02-22708', capa: 'e79b53ae-8822-491d-9f56-c3f28f190c11' },
  { url: 'https://www.leilaovip.com.br/evento/anuncio/direitos-sobre-apto-com-4877m-vila-caputera-22536', capa: '98fc7b1b-e99d-408e-a1ff-a8f50efd1541' },
  { url: 'https://www.leilaovip.com.br/evento/anuncio/terreno-com-25167m-resid-mirante-do-jequitiba-22481', capa: '4f4aa915-6c36-4f2c-9812-11dd74702fe0' },
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const BLOB = 'armazupleilaovipprd.blob.core.windows.net/uploads/';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
for (const { url, capa } of ALVOS) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const apis = [];
  page.on('response', async (r) => {
    try {
      const ct = r.headers()['content-type'] || '';
      if (!/json/i.test(ct)) return;
      const t = await r.text();
      if (t.includes('uploads/') || /foto|imagem|galeria/i.test(t.slice(0, 2000))) apis.push({ url: r.url(), n: (t.match(/uploads\//g) || []).length, amostra: t.slice(0, 600) });
    } catch { /* corpo indisponível (redirect/preflight) — recon, segue */ }
  });
  console.log(`\n\n════════ ${url} (capa ${capa}) ════════`);
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log(`  HTTP ${resp?.status()} · URL final ${page.url()} · título "${await page.title()}"`);
    await new Promise((r) => setTimeout(r, 4000));
    // Clica em "próxima" de carrossel, se houver, para disparar lazy-load.
    const fotos = await page.evaluate((BLOB) => {
      const caminho = (el) => { const p = []; for (let e = el, i = 0; e && i < 7; e = e.parentElement, i++) p.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`); return p.join(' < '); };
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const attrs = ['src', 'data-src', 'srcset', 'href', 'data-lazy', 'data-image', 'style'].map((a) => el.getAttribute(a)).filter(Boolean).join(' ');
        if (!attrs.includes(BLOB)) continue;
        const ids = [...attrs.matchAll(/uploads\/([0-9a-f-]{36})/g)].map((m) => m[1]);
        for (const id of ids) out.push({ id, tag: el.tagName.toLowerCase(), caminho: caminho(el) });
      }
      return out;
    }, BLOB);
    console.log(`  ${fotos.length} referências ao blob no DOM:`);
    fotos.forEach((f, i) => console.log(`   [${i}] ${f.id === capa ? '★CAPA ' : ''}${f.id} <${f.tag}> ${f.caminho}`));
    const html = await page.content();
    const noHtml = [...new Set([...html.matchAll(/uploads\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
    console.log(`  UUIDs distintos no HTML renderizado: ${noHtml.length} (capa presente: ${noHtml.includes(capa)})`);
    for (const k of ['__NEXT_DATA__', 'window.__', 'fotos', 'imagens', 'galeria']) {
      const i = html.indexOf(k); if (i >= 0) console.log(`  marcador "${k}" @${i}: ${html.slice(Math.max(0, i - 80), i + 220).replace(/\s+/g, ' ')}`);
    }
    console.log(`  APIs JSON com foto: ${apis.length}`);
    apis.slice(0, 8).forEach((a) => console.log(`   ${a.url} (${a.n} uploads) ${a.amostra.replace(/\s+/g, ' ')}`));
  } catch (e) { console.log(`  ERRO: ${e.message}`); }
  await page.close();
}
await browser.close();
