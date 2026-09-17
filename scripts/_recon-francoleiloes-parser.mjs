// TEMPORÁRIO — recon final antes de escrever o parser de produção do FRANCOLEILOES.
// Já confirmado (isolarSessao): home lista /lote/<leilao-slug>/<id>/ direto (48 reais), detalhe
// carrega limpo (R$6.046.287,22, comissão 5%, endereço, área privativa, 6 PDFs). Falta: (a) o
// TEXTO dos links de PDF (preview/download são UUID opaco — só o texto do <a> classifica
// edital/matrícula/laudo), (b) confirmar se existe 2ª praça em algum lote (a amostra só tinha
// "Praça Única"), (c) achar onde a modalidade (judicial/extrajudicial) aparece, se aparece.
import puppeteer from 'puppeteer';

const URL_LOTE = 'https://www.francoleiloes.com.br/lote/leilao-banco-inter/9728/';
const URL_HOME = 'https://www.francoleiloes.com.br/';

async function abrirIsolado(browser, url) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
  try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { console.log(`  erro: ${e.message}`); }
  await new Promise(r => setTimeout(r, 3500));
  const html = await page.content();
  const anchors = await page.$$eval('a', as => as.map(a => ({ href: a.getAttribute('href') || '', texto: (a.textContent || '').trim().slice(0, 80) })).filter(l => l.href)).catch(() => []);
  await ctx.close();
  return { html, anchors };
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  console.log(`### DETALHE: ${URL_LOTE}`);
  const det = await abrirIsolado(browser, URL_LOTE);
  const pdfAnchors = det.anchors.filter(a => /\.pdf/i.test(a.href) || /preview|download/i.test(a.href));
  console.log(`PDFs/preview/download com texto de link (${pdfAnchors.length}):`);
  for (const a of pdfAnchors) console.log(`  "${a.texto}" -> ${a.href}`);

  const txt = det.html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`\njudicial/extrajudicial no texto? ${/judicial/i.test(txt)}`);
  const mJud = txt.match(/.{0,40}(judicial|extrajudicial|processo\s*n[ºo°]).{0,40}/i);
  if (mJud) console.log(`contexto: "${mJud[0]}"`);
  console.log(`2ª praça / segundo leilão no texto? ${/2[ºo°]?\s*(pra[çc]a|leil[ãa]o)/i.test(txt)}`);
  console.log(`matrícula no texto? ${/matr[íi]cula/i.test(txt)}`);
  const mMat = txt.match(/.{0,20}matr[íi]cula.{0,60}/i);
  if (mMat) console.log(`contexto matrícula: "${mMat[0]}"`);

  // Página inteira (title/h1) pra achar o formato exato "Cidade/UF - Bairro - Tipo"
  const mTitle = det.html.match(/<title>([^<]+)<\/title>/i);
  console.log(`\n<title>: ${mTitle ? mTitle[1] : '(não achado)'}`);

  console.log(`\n### HOME (novo contexto): ${URL_HOME}`);
  const home = await abrirIsolado(browser, URL_HOME);
  const lotes = home.anchors.filter(a => /\/lote\/[\w-]+\/\d+/i.test(a.href));
  const unicos = [...new Map(lotes.map(l => [l.href, l])).values()];
  console.log(`${unicos.length} <a> únicos de lote na home. Amostra de texto de âncora (10):`);
  for (const l of unicos.slice(0, 10)) console.log(`  "${l.texto}" -> ${l.href}`);

  await browser.close();
  console.log('\n═══ FIM');
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
