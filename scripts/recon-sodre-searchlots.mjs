/**
 * RECON SODRE — mapeia a API pública `search-lots` (lote → URL/leilão/documentos).
 * Abre /imoveis no navegador, intercepta o POST /api/search-lots e dumpa o corpo da
 * requisição + o schema/primeiro lote da resposta, procurando URLs de doc
 * (arquivos.sodresantoro / anexos / matrícula). Cruza com alguns fonte_id nossos.
 * Não grava. Config: nenhuma (API é pública).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const { data: nossos } = await supabase.from('imoveis_leilao').select('fonte_id').eq('fonte', 'SODRE').eq('ativo', true).limit(35);
  const idsNossos = (nossos || []).map(x => String(x.fonte_id).replace(/^sodre_/, ''));
  console.log(`Nossos lotes SODRE (${idsNossos.length}): ${idsNossos.slice(0, 10).join(', ')}…`);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const caps = [];
  page.on('request', req => { if (/\/api\/search-lots/i.test(req.url()) && req.method() === 'POST') caps.push({ tipo: 'req', body: (req.postData() || '').slice(0, 300) }); });
  page.on('response', async r => {
    if (/\/api\/search-lots/i.test(r.url())) { let t = ''; try { t = await r.text(); } catch { t = ''; } caps.push({ tipo: 'res', status: r.status(), text: t }); }
  });
  try {
    await page.goto('https://www.sodresantoro.com.br/imoveis', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3500);
    const req = caps.find(c => c.tipo === 'req');
    const res = caps.find(c => c.tipo === 'res' && c.text);
    console.log(`\nPOST body: ${req?.body || '(não capturado)'}`);
    if (!res) { console.log('resposta search-lots não capturada'); return; }
    let json = null; try { json = JSON.parse(res.text); } catch { /* */ }
    console.log(`\nResposta status=${res.status} tamanho=${res.text.length}`);
    console.log(`top-level keys: ${json ? JSON.stringify(Object.keys(json)).slice(0, 200) : '(não-JSON)'}`);
    // acha o array de lotes
    const arr = json && (Array.isArray(json) ? json : json.data || json.lots || json.results || json.items || json.hits || (json.data && json.data.lots));
    const lista = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.lots) ? arr.lots : null);
    console.log(`lotes no array: ${Array.isArray(lista) ? lista.length : 'n/d'}`);
    if (Array.isArray(lista) && lista.length) {
      console.log(`\n1º lote (chaves): ${JSON.stringify(Object.keys(lista[0]))}`);
      console.log(`1º lote (amostra): ${JSON.stringify(lista[0]).slice(0, 900)}`);
    }
    // procura sinais de doc/URL na resposta inteira
    const marcadores = ['arquivos.sodresantoro', 'anexos/', 'matricul', 'edital', 'auction', 'lot_id', 'lotId', 'slug', '/leilao/'];
    console.log('\nmarcadores na resposta:');
    marcadores.forEach(m => { const i = res.text.toLowerCase().indexOf(m.toLowerCase()); console.log(`   ${m}: ${i >= 0 ? 'SIM @' + i + ' → ' + res.text.slice(i, i + 80).replace(/\s+/g, ' ') : 'não'}`); });
    // cruza com nossos ids
    const bate = idsNossos.filter(id => res.text.includes(id));
    console.log(`\nnossos ids presentes na resposta: ${bate.length}/${idsNossos.length} ${bate.slice(0, 8).join(', ')}`);
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim recon search-lots.');
}
main().catch(e => { console.error(e); process.exit(1); });
