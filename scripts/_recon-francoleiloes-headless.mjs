// TEMPORÁRIO — testa se francoleiloes.com.br é acessível via HEADLESS (Puppeteer real, JS
// rodando) já que o recon anterior (fetch cru via Bright Data Web Unlocker) confirmou 0 sinais
// de R$/lote no HTML crú — 77% do corpo é <script>, veredito "SPA, precisa de JS pra ver
// conteúdo". Este recon NÃO grava nada; só mede se headless destrava e como fica a estrutura.
import puppeteer from 'puppeteer';

const BASE = process.env.FRANCO_BASE || 'https://www.francoleiloes.com.br';

const MARCADORES = [
  ['challenge', /just a moment|cf-browser-verification|checking your browser|attention required/i],
  ['captcha', /captcha|recaptcha|hcaptcha|turnstile/i],
  ['erro_app', /\b(erro|error)\b.{0,40}\b(500|interno|inesperado)\b/i],
];

function marcasEm(texto) {
  const out = [];
  for (const [nome, re] of MARCADORES) if (re.test(texto)) out.push(nome);
  return out;
}

const PADROES_LINK = [
  { nome: '/lote/', re: /\/lote[s]?\/[\w-]+/i },
  { nome: '/leilao/', re: /\/leil(?:a|ã)o(?:-de-imoveis)?\/[\w-]+/i },
  { nome: '/imovel/', re: /\/imov(?:e|é)is?\/[\w-]+/i },
  { nome: '/bem/', re: /\/bem[s]?\/[\w-]+/i },
];

async function screenshotB64(page, path) {
  await page.screenshot({ path, fullPage: true });
  const fs = await import('node:fs');
  const b64 = fs.readFileSync(path).toString('base64');
  console.log(`BASE64_PNG_INICIO(${path})(${b64.length} chars)`);
  for (let i = 0; i < b64.length; i += 2000) console.log(b64.slice(i, i + 2000));
  console.log(`BASE64_PNG_FIM(${path})`);
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');

  console.log(`🔎 RECON HEADLESS — francoleiloes.com.br\n`);
  console.log('1) HOME renderizada — JS destrava o conteúdo?');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000)); // margem extra pra hidratação tardia

  const htmlRenderizado = await page.content();
  const textoVisivel = await page.evaluate(() => document.body.innerText);
  console.log(`  HTML renderizado: ${htmlRenderizado.length} chars | texto visível: ${textoVisivel.length} chars`);

  const qtdReais = (textoVisivel.match(/R\$\s?[\d.,]+/g) || []).length;
  console.log(`  sinais de R$ no texto VISÍVEL (pós-JS): ${qtdReais}`);
  console.log(qtdReais > 0 ? '  → JS revelou conteúdo real (headless destrava)' : '  → ainda 0 R$ mesmo pós-JS — não é só timing');

  const marcas = marcasEm(htmlRenderizado);
  if (marcas.length) console.log(`  ⚠️ marcas encontradas: ${marcas.join(', ')}`);

  console.log(`  trecho do texto visível (900 chars): "${textoVisivel.replace(/\s+/g, ' ').trim().slice(0, 900)}"`);

  // 2) Links reais que a página DOM expõe (depois do JS) — não regex no HTML crú.
  console.log('\n2) LINKS internos que a página expõe após o JS rodar');
  const links = await page.$$eval('a', as => as.map(a => ({ href: a.getAttribute('href') || '', texto: (a.textContent || '').trim().slice(0, 60) })).filter(l => l.href));
  const internos = links.filter(l => l.href.startsWith('/') || l.href.includes('francoleiloes.com.br'));
  console.log(`  ${links.length} <a> total · ${internos.length} internos`);

  const candidatosLote = internos.filter(l => PADROES_LINK.some(p => p.re.test(l.href)));
  console.log(`  candidatos a lote (bate algum padrão conhecido): ${candidatosLote.length}`);
  for (const c of candidatosLote.slice(0, 8)) console.log(`    ${c.href}  ("${c.texto}")`);

  // Links de menu que podem ser a listagem/catálogo (texto sugestivo), mesmo sem bater padrão.
  const candidatosMenu = internos.filter(l => /leil[ãa]o|lote|im[óo]ve|cat[áa]logo|busca/i.test(l.texto + ' ' + l.href))
    .filter(l => !candidatosLote.includes(l));
  const menuUnico = [...new Map(candidatosMenu.map(l => [l.href, l])).values()];
  console.log(`  candidatos a MENU/catálogo (texto sugestivo, ${menuUnico.length} únicos):`);
  for (const c of menuUnico.slice(0, 10)) console.log(`    ${c.href}  ("${c.texto}")`);

  await screenshotB64(page, 'print-franco-home.png');

  // 3) Se achou candidato a lote direto na home, abre 1 e dissecta.
  let detalheUrl = candidatosLote[0]?.href;
  if (detalheUrl && !detalheUrl.startsWith('http')) detalheUrl = new URL(detalheUrl, BASE).toString();

  // 4) Senão, tenta o 1º candidato de MENU (pode ser a página de listagem real).
  let listagemUrl = menuUnico[0]?.href;
  if (listagemUrl && !listagemUrl.startsWith('http')) listagemUrl = new URL(listagemUrl, BASE).toString();

  if (listagemUrl) {
    console.log(`\n3) Abrindo candidato a LISTAGEM: ${listagemUrl}`);
    await page.goto(listagemUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('  erro ao abrir:', e.message));
    await new Promise(r => setTimeout(r, 3000));
    const txtListagem = await page.evaluate(() => document.body.innerText);
    const rsListagem = (txtListagem.match(/R\$\s?[\d.,]+/g) || []).length;
    console.log(`  texto visível: ${txtListagem.length} chars · sinais de R$: ${rsListagem}`);
    console.log(`  trecho (900 chars): "${txtListagem.replace(/\s+/g, ' ').trim().slice(0, 900)}"`);
    const linksListagem = await page.$$eval('a', as => as.map(a => a.getAttribute('href') || '').filter(Boolean));
    const loteNaListagem = linksListagem.filter(h => PADROES_LINK.some(p => p.re.test(h)));
    const loteUnicos = [...new Set(loteNaListagem)];
    console.log(`  links de lote encontrados na listagem: ${loteUnicos.length}`);
    for (const l of loteUnicos.slice(0, 8)) console.log(`    ${l}`);
    if (!detalheUrl && loteUnicos[0]) detalheUrl = loteUnicos[0].startsWith('http') ? loteUnicos[0] : new URL(loteUnicos[0], BASE).toString();
    await screenshotB64(page, 'print-franco-listagem.png');
  } else {
    console.log('\n3) Nenhum candidato a listagem achado no menu — pulando.');
  }

  if (detalheUrl) {
    console.log(`\n4) Abrindo candidato a DETALHE DE LOTE: ${detalheUrl}`);
    await page.goto(detalheUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('  erro ao abrir:', e.message));
    await new Promise(r => setTimeout(r, 3000));
    const txtDetalhe = await page.evaluate(() => document.body.innerText);
    console.log(`  texto visível (1200 chars): "${txtDetalhe.replace(/\s+/g, ' ').trim().slice(0, 1200)}"`);
    await screenshotB64(page, 'print-franco-detalhe.png');
  } else {
    console.log('\n4) Nenhum candidato a detalhe de lote encontrado em home/listagem — sem página pra dissecar.');
  }

  console.log('\n═══ FIM DO RECON HEADLESS');
  await browser.close();
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
