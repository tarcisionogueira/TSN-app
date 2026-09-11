/**
 * RECON — existe sinal de modalidade (judicial/extrajudicial) na página de DETALHE do
 * veículo na plataforma SUPORTE? (11/09, pergunta do dono: dá para ler número de processo
 * ou Tribunal citado na descrição?)
 *
 * Por que este script existe, em vez de já escrever o regex: o texto que HOJE já
 * capturamos (titulo/descricao da LISTAGEM) tem zero ocorrência de processo/tribunal nos
 * 117 veículos do SUPORTE — confirmado por SQL antes deste recon. A pergunta certa não é
 * "que regex escrever", é "esse dado existe na página de DETALHE, que ainda não visitamos
 * para veículo?". Sem essa resposta, regex seria a mesma forma de erro que mordeu o SOLEON
 * hoje mais cedo (medir contra suposição, não contra HTML real).
 *
 * Uso: node scripts/recon-modalidade-veiculo.mjs <url1> [url2] [url3]
 */
import puppeteer from 'puppeteer';

const RE_CNJ = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
const RE_ORGAO = /\b(vara|f[óo]rum|tribunal|tj[a-z]{2}|comarca|processo\s*n?[ºo°]?\s*[\d.\-/]{5,}|judicial|extrajudicial)\b/gi;

async function main() {
  // RECON_URLS (csv) além dos argv: evita interpolar URL de usuário/CI direto num shell
  // `run:` de workflow (command injection) — o dispatch do GitHub Actions passa por env,
  // não por argumento de linha de comando montado na mão.
  const urls = [...process.argv.slice(2), ...String(process.env.RECON_URLS || '').split(',')]
    .map(u => u.trim()).filter(Boolean);
  if (!urls.length) { console.error('uso: node scripts/recon-modalidade-veiculo.mjs <url...>  (ou RECON_URLS=csv)'); process.exit(1); }
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const url of urls) {
      console.log(`\n════ ${url}`);
      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(r => setTimeout(r, 1500));
        const html = await page.content();
        const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
        const cnj = [...txt.matchAll(RE_CNJ)].map(m => m[0]);
        const orgao = [...txt.matchAll(RE_ORGAO)].map(m => txt.slice(Math.max(0, m.index - 40), m.index + 60).trim());
        console.log(`  número CNJ (${cnj.length}):`, JSON.stringify(cnj));
        console.log(`  contexto órgão/processo (${orgao.length}):`, JSON.stringify(orgao.slice(0, 10)));
        if (!cnj.length && !orgao.length) console.log('  NADA encontrado nesta página.');
      } catch (e) {
        console.log(`  falha: ${String(e?.message || e).slice(0, 150)}`);
      } finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close(); }
}

main().catch(e => { console.error(e); process.exit(1); });
