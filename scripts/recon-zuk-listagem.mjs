/**
 * RECON (só leitura) — a listagem da ZUK traz o acervo INTEIRO? (25/09). O coletor desliga como
 * `sumiu_da_fonte` ~100-160 lotes ZUK por dia; 58 deles têm 2ª praça futura e lance correndo na
 * página (ex.: Z37342, 37430-234156). Hipótese: o laço do "Carregar mais" para cedo (3 voltas sem
 * crescer × 1,6 s) ou a ordem muda entre páginas. Aqui: o total que o SITE declara × os cards
 * carregados (laço igual ao coletor e laço paciente), e quais dos lotes desligados aparecem.
 * Nada é gravado. Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY (só leitura dos ids desligados).
 */
import puppeteer from 'puppeteer';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
let desligados = [];
if (SB_URL && SB_KEY) {
  const r = await fetch(`${SB_URL}/rest/v1/imoveis_leilao?fonte=eq.ZUK&ativo=eq.false&suprimido_motivo=eq.sumiu_da_fonte&data_leilao_2=gt.${new Date().toISOString()}&select=fonte_id,data_leilao,data_leilao_2`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (r.ok) desligados = await r.json(); else console.log('supabase HTTP', r.status, '— sigo sem a lista de desligados');
}
console.log(`desligados com 2ª praça futura: ${desligados.length}`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
async function carregar(paciente) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  const posts = [];
  page.on('response', (res) => { if (/leilao-de-imoveis\/mais/.test(res.url())) posts.push(res.status()); });
  await page.goto('https://www.portalzuk.com.br/leilao-de-imoveis', { waitUntil: 'networkidle2', timeout: 60000 });
  const declarado = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, ' ');
    return (t.match(/([\d.]+)\s*(?:im[óo]ve(?:is|l)|resultados?|lotes?)\s*(?:encontrad|dispon)/i) || t.match(/(?:total|exibindo)[^\d]{0,30}([\d.]+)/i) || [])[0] || null;
  });
  let prev = 0, estavel = 0, voltas = 0;
  const limiteEstavel = paciente ? 8 : 3;
  for (let i = 0; i < 600 && estavel < limiteEstavel; i++) {
    voltas++;
    const { n, btn } = await page.evaluate(() => {
      const b = document.querySelector('#btn_carregarMais');
      const vis = !!(b && b.offsetParent !== null);
      if (vis) { b.scrollIntoView({ block: 'center' }); b.click(); } else window.scrollTo(0, document.body.scrollHeight);
      return { n: document.querySelectorAll('.card-property').length, btn: vis };
    });
    if (paciente) { try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }); } catch { /* padrao-ok: recon, espera é só folga */ } }
    else await new Promise(r => setTimeout(r, 1600));
    if (n <= prev) estavel++; else { estavel = 0; prev = n; }
    if (paciente && !btn && estavel >= 2) break;
  }
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('.card-property a[href*="/imovel/"]')].map(a => a.href.split('?')[0]));
  const ids = new Set(hrefs.map(h => (h.match(/(\d+(?:-\d+)?)\/?$/) || [])[1]).filter(Boolean));
  const botaoAinda = await page.evaluate(() => { const b = document.querySelector('#btn_carregarMais'); return !!(b && b.offsetParent !== null); });
  await page.close();
  const achados = desligados.filter(d => ids.has(String(d.fonte_id).replace(/^zuk_/, '')));
  console.log(`\n[${paciente ? 'PACIENTE' : 'IGUAL AO COLETOR'}] declarado pelo site: ${declarado} · cards ${hrefs.length} · ids únicos ${ids.size} · voltas ${voltas} · botão ainda visível no fim: ${botaoAinda}`);
  console.log(`  POST /mais: ${posts.length} (status ${JSON.stringify([...new Set(posts)])})`);
  console.log(`  dos ${desligados.length} desligados com 2ª praça futura, aparecem na listagem: ${achados.length}${achados.length ? ' → ' + achados.slice(0, 10).map(a => a.fonte_id).join(', ') : ''}`);
  console.log(`  Z37342 (37430-234156) na listagem: ${ids.has('37430-234156')}`);
  return ids;
}
try {
  const a = await carregar(false);
  const b = await carregar(true);
  const soB = [...b].filter(x => !a.has(x)).length, soA = [...a].filter(x => !b.has(x)).length;
  console.log(`\nsó no paciente: ${soB} · só no igual-ao-coletor: ${soA}`);
} finally { await browser.close(); }
