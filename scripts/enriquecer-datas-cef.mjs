#!/usr/bin/env node
/**
 * Enriquecimento de DATAS da Caixa (CEF) — ROTA 2, no runner do GitHub (grátis).
 *
 * A data de licitação/leilão da Caixa é renderizada por JavaScript — um fetch cru
 * pega o HTML "vazio" (confirmado: 1000 páginas, 0 datas). Então visitamos cada
 * página NO NAVEGADOR (puppeteer) e lemos o texto RENDERIZADO — mesma técnica que
 * resolveu o ZUK (42 → 539). Venda direta é venda contínua (sem data) e é ignorada.
 *
 * Pool de páginas + deadline: processa um lote por execução (rotaciona por
 * enriquecido_em) para caber no timeout da Action; execuções seguintes cobrem o resto.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: CEF_DATAS_LIMITE, CEF_DATAS_CONC.
 */
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.CEF_DATAS_LIMITE || '4000', 10);
const CONC = parseInt(process.env.CEF_DATAS_CONC || '5', 10);
const DEADLINE = Date.now() + 75 * 60 * 1000; // para antes do timeout de 90 min
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,900'];

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB, KEY);

// Extrai a data do próximo leilão/licitação do TEXTO renderizado.
// Inclui rótulos de LICITAÇÃO ABERTA (fim/recebimento de propostas), que valem
// como data-limite do certame — o usuário planeja em cima dela igual a um leilão.
function extrairDataLeilao(txt) {
  if (!txt) return null;
  const re = /(?:leil[ãa]o|pra[çc]a|encerra|licita[çc][ãa]o|proposta|recebimento|limite|abertura|data)[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{2,4})/gi;
  const ontem = Date.now() - 86400000;
  const limite = Date.now() + 400 * 86400000;
  const futuras = [];
  let m;
  while ((m = re.exec(txt))) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const t = Date.parse(`${y}-${m[2]}-${m[1]}`);
    if (!isNaN(t) && t >= ontem && t < limite) futuras.push(t);
  }
  if (!futuras.length) return null;
  return new Date(Math.min(...futuras)).toISOString().slice(0, 10);
}

async function novaPagina(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  try {
    await page.setRequestInterception(true);
    page.on('request', req => {
      const t = req.resourceType();
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet') req.abort();
      else req.continue();
    });
  } catch { /* segue sem interceptar */ }
  return page;
}

// O Supabase limita cada resposta a ~1000 linhas; paginamos com range() para
// juntar até LIMITE candidatos numa única execução (senão só cobria 1000/dia).
async function buscarCandidatos() {
  const PAG = 1000;
  const out = [];
  while (out.length < LIMITE) {
    const { data, error } = await supabase.from('imoveis_leilao')
      .select('id, link_edital, url_lote')
      .eq('fonte', 'CEF').eq('ativo', true).is('data_leilao', null)
      .not('modalidade', 'ilike', '%venda%direta%')
      .not('url_lote', 'is', null)
      .order('enriquecido_em', { ascending: true, nullsFirst: true })
      .range(out.length, out.length + PAG - 1);
    if (error) { console.error('query erro:', error.message); break; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAG) break;
  }
  return out.slice(0, LIMITE);
}

async function main() {
  const cands = await buscarCandidatos();
  if (!cands?.length) { console.log('CEF: sem candidatos sem data.'); return; }
  console.log(`CEF sem data (não venda direta): ${cands.length} candidatos · conc ${CONC} · limite ${LIMITE}`);

  const browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
  let idx = 0, ok = 0, semData = 0, falha = 0, feitos = 0;

  async function worker() {
    const page = await novaPagina(browser);
    while (idx < cands.length && Date.now() < DEADLINE) {
      const im = cands[idx++];
      const url = im.url_lote || im.link_edital;
      const patch = { enriquecido_em: new Date().toISOString() };
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        const txt = await page.evaluate(() => document.body?.innerText || '');
        const d = extrairDataLeilao(txt);
        if (d) { patch.data_leilao = d; ok++; } else semData++;
      } catch { falha++; }
      feitos++;
      await supabase.from('imoveis_leilao').update(patch).eq('id', im.id).then(() => {}, () => {});
      if (feitos % 100 === 0) console.log(`  ${feitos}/${cands.length} · datas ${ok} · sem-data ${semData} · falha ${falha}`);
    }
    try { await page.close(); } catch {}
  }

  await Promise.all(Array.from({ length: CONC }, () => worker()));
  await browser.close();
  console.log(`FIM CEF datas: preenchidas ${ok} · sem-data-na-pagina ${semData} · falha ${falha} · processados ${feitos}`);
}

main().catch(e => { console.error(e); process.exit(1); });
