/**
 * RECON — de ONDE vem a data de leilão da PESTANA (roda em PRODUÇÃO; precisa de rede/Chromium).
 *
 * POR QUE: 21/08 o dono achou a divergência — a fonte (Santander via Pestana) mostra pregão em
 * 25/08/2026 11h, e nós gravamos 26/10/2026 para o lote de Barueri/SP. Pior: TODOS os 1.031 lotes
 * ativos da PESTANA têm a MESMA data (26/10). O mapper usa `leilao.data` (parseDataPestana), que
 * claramente NÃO é a data por-leilão. Este recon dumpa TODOS os campos de data do objeto `leilao`
 * e do `lote` para descobrir qual campo carrega o 25/08 real — antes de mexer no scraper (não
 * chutar e gravar uma segunda data errada).
 *
 * Uso (produção): node scripts/recon-pestana-data.mjs
 * Opcional: PESTANA_ALVO="212.854" (matrícula) ou "329800" (valor) para focar num lote conhecido.
 */
import puppeteer from 'puppeteer';

const BASE = 'https://www.pestanaleiloes.com.br';
const TIPOBEM_IMOVEL = 462;
const ALVO = process.env.PESTANA_ALVO || '212.854';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

// Campos com cara de data em qualquer objeto (nome contém data/date/dt/pregao/praca/inicio/fim/abertura).
function camposDeData(obj, prefixo = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const kl = k.toLowerCase();
    if (/data|date|\bdt|pregao|prac|inicio|fim|abertura|encerr|leilao/.test(kl) && (typeof v === 'string' || typeof v === 'number')) {
      out[prefixo + k] = v;
    }
    // arrays de praças costumam ter as datas de 1ª/2ª praça
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      v.slice(0, 3).forEach((it, i) => Object.assign(out, camposDeData(it, `${prefixo}${k}[${i}].`)));
    }
  }
  return out;
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/lotes/imoveis`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const leiloes = await page.evaluate(async () => {
      try { const r = await fetch('/api/v2/leilao', { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
      catch { return null; }
    });
    if (!Array.isArray(leiloes)) { console.log('❌ /api/v2/leilao não retornou lista'); return; }
    const imov = leiloes.filter(l => Array.isArray(l.subTipoBens) && l.subTipoBens.some(s => Number(s.tipoBem) === TIPOBEM_IMOVEL));
    console.log(`Leilões com imóveis: ${imov.length}/${leiloes.length}\n`);

    // Todas as chaves de UM leilão + os campos de data de cada leilão (é aqui que 25/08 deve estar).
    if (imov[0]) console.log('CHAVES do objeto leilao:', Object.keys(imov[0]).join(', '), '\n');
    console.log('== CAMPOS DE DATA por LEILÃO (id · nome · campos-data) ==');
    for (const l of imov.slice(0, 15)) {
      console.log(`  #${l.id} "${String(l.nome || '').slice(0, 70)}"`, JSON.stringify(camposDeData(l)));
    }

    // Acha o lote ALVO e dumpa os campos de data DELE + do leilão dono.
    console.log(`\n== procurando lote ALVO ~"${ALVO}" ==`);
    for (const l of imov) {
      const lotes = await page.evaluate(async (id) => {
        try { const r = await fetch(`/api/v2/lote?leilao=${id}&page=1&qtd=300`, { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
        catch { return null; }
      }, l.id).catch(() => null);
      if (!Array.isArray(lotes)) continue;
      const hit = lotes.find(x => JSON.stringify(x).includes(ALVO));
      if (hit) {
        console.log(`ACHADO na LISTA do leilão #${l.id} "${l.nome}" (data ${l.data})`);
        console.log('  lote.leilao (o leilão REAL a que o lote pertence):', hit.leilao);
        const real = leiloes.find(x => Number(x.id) === Number(hit.leilao));
        if (real) {
          console.log(`  >>> LEILÃO REAL #${real.id} "${real.nome}" · data=${real.data} · leiloeiro=${real.leiloeiro || ''}`);
        } else {
          console.log('  >>> leilão real NÃO está na lista /api/v2/leilao (id', hit.leilao, ')');
        }
        console.log('  HOJE usamos a data da LISTA (', l.data, ') via mapLotePestana(lote, leilao-da-iteração).');
        break;
      }
    }
    console.log('\n➡️  Ache o campo cujo valor é 25/08/2026 — é esse que o mapper deve usar (fallback: parse de leilao.nome). NÃO gravamos nada aqui.');
  } finally {
    await browser.close().catch(() => {});
  }
})();
