/**
 * Captura de documentos do SODRE — PÚBLICO (sem login). Descoberto via navegador:
 *  - API pública `www.sodresantoro.com.br/api/search-lots` (ElasticSearch) dá, por lote,
 *    o `lot_id` e o `auction_id`.
 *  - Com isso, a página real do lote é `leilao.sodresantoro.com.br/leilao/{auction}/lote/{lot}/`
 *    e os documentos são PDFs públicos em `arquivos.sodresantoro.com.br/anexos/…` (matrícula/
 *    edital) e `…/catalogos/leilao{auction}.pdf`.
 * Fluxo: captura o corpo real do search-lots (no navegador), replica paginando p/ mapear
 * lot_id→auction_id, e abre a página de cada lote nosso p/ ler as âncoras de documento.
 * Grava anexos + link_matricula + url_lote + link_foto (og:image da página do lote —
 * o scraper de listagem chutava um campo de imagem inexistente da API e deixava a
 * foto do SODRE sempre nula). Config: SD_LOTE (default 40).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const LOTE = Number(process.env.SD_LOTE || 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function classifica(txt, url) {
  const t = `${txt || ''} ${url || ''}`;
  // Aceita também a abreviação do SODRE ("Matr." / "Matr 12345"), não só "matrícula".
  if (/matr[ií]cul|\bmatr\.?\b/i.test(t)) return 'matricula';
  if (/laudo|avalia[çc]/i.test(t)) return 'laudo';
  if (/edital/i.test(t)) return 'edital';
  if (/cat[áa]logo/i.test(t)) return 'anexo';
  return 'anexo';
}

async function main() {
  const { data: pend } = await supabase.from('imoveis_leilao')
    .select('id, fonte_id, data_leilao').eq('fonte', 'SODRE').eq('ativo', true)
    // Falta anexo OU foto: assim os lotes que já têm doc mas seguem sem foto
    // também entram p/ o backfill de og:image (auto-limitante — some do filtro
    // assim que link_foto é preenchido).
    .or('anexos.is.null,anexos.eq.[],link_foto.is.null').limit(LOTE);
  const nossos = new Map((pend || []).map(l => [String(l.fonte_id).replace(/^sodre_/, ''), { id: l.id, data: l.data_leilao }]));
  if (!nossos.size) { console.log('SODRE: nenhum lote pendente.'); return; }
  console.log(`SODRE: ${nossos.size} lote(s) pendentes.`);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  let corpo = null, urlApi = null;
  page.on('request', req => { if (/\/api\/search-lots/i.test(req.url()) && req.method() === 'POST' && !corpo) { corpo = req.postData(); urlApi = req.url(); } });

  const mapa = new Map(); // lot_id → auction_id
  try {
    await page.goto('https://www.sodresantoro.com.br/imoveis', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3000);
    if (!corpo) { console.log('não capturei o corpo do search-lots'); return; }
    // replica paginando (a resposta traz total/page/perPage)
    const base = JSON.parse(corpo);
    for (let pg = 1; pg <= 30; pg++) {
      const body = { ...base, page: pg, perPage: 100 };
      const json = await page.evaluate(async (u, b) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), credentials: 'include' }); return await r.json(); }, urlApi, body).catch(() => null);
      const arr = json && (json.results || json.data || json.hits || []);
      if (!Array.isArray(arr) || !arr.length) break;
      for (const it of arr) { const lid = String(it.lot_id ?? it.lotId ?? it.id ?? ''); const aid = it.auction_id ?? it.auctionId; if (lid && aid) mapa.set(lid, aid); }
      const total = json.total || 0, perPage = json.perPage || 100;
      if (pg * perPage >= total) break;
    }
    console.log(`mapa lot→auction: ${mapa.size} lotes online mapeados.`);

    let ok = 0, semMap = 0, semDoc = 0, erro = 0;
    const fim = Date.now() + 22 * 60 * 1000;
    for (const [lid, { id: imovelId, data: dataLeilao }] of nossos) {
      if (Date.now() > fim) { console.log('deadline — resto p/ próxima rodada'); break; }
      const aid = mapa.get(lid);
      if (!aid) {
        semMap++;
        // Fora do search-lots + data do leilão no passado = ENCERRADO. Expira (ativo=false)
        // p/ não virar lote-zumbi (ativo mas sumido da fonte, poluindo busca e fila de docs).
        if (dataLeilao && Date.parse(dataLeilao) < Date.now()) {
          await supabase.from('imoveis_leilao').update({ ativo: false }).eq('id', imovelId);
          console.log(`× sodre_${lid}: leilão encerrado (${dataLeilao}) → expirado`);
        } else console.log(`- sodre_${lid}: não achado no search-lots (leilão encerrado?)`);
        continue;
      }
      const loteUrl = `https://leilao.sodresantoro.com.br/leilao/${aid}/lote/${lid}/`;
      try {
        await page.goto(loteUrl, { waitUntil: 'networkidle2', timeout: 40000 });
        await sleep(2500);
        // Além dos PDFs, lê a FOTO de capa do lote (og:image — meta padrão).
        // Reaproveita este page-load que já ocorre; corrige o SODRE sem foto.
        const { docs, foto } = await page.evaluate(() => ({
          docs: [...document.querySelectorAll('a[href]')]
            .map(a => ({ t: (a.textContent || '').replace(/\s+/g, ' ').trim(), h: a.href }))
            .filter(a => /arquivos\.sodresantoro\.com\.br\/(anexos|catalogos)\//i.test(a.h)),
          foto: document.querySelector('meta[property="og:image"], meta[name="og:image"]')?.content
            || document.querySelector('link[rel="image_src"]')?.href || null,
        }));
        const fotoUrl = (foto && /^https?:\/\//.test(foto)) ? foto : null;
        if (!docs.length) {
          // Sem PDF, mas grava a foto de capa se houver (não perde o imóvel).
          if (fotoUrl) { await supabase.from('imoveis_leilao').update({ link_foto: fotoUrl }).eq('id', imovelId); ok++; console.log(`~ sodre_${lid}: sem PDF, foto capturada`); }
          else { semDoc++; console.log(`- sodre_${lid}: página sem PDFs (${loteUrl})`); }
          continue;
        }
        const vistos = new Set();
        const anexos = [];
        let matricula = null;
        for (const d of docs) {
          const url = d.h.split('#')[0];
          if (vistos.has(url)) continue; vistos.add(url);
          const tipo = classifica(d.t, url);
          const nome = d.t && d.t.length > 2 ? d.t.slice(0, 60) : (tipo[0].toUpperCase() + tipo.slice(1));
          anexos.push({ nome, url, tipo });
          if (tipo === 'matricula' && !matricula) matricula = url;
        }
        const ordem = { matricula: 0, edital: 1, laudo: 2, anexo: 3 };
        anexos.sort((a, b) => (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9));
        const upd = { anexos, url_lote: loteUrl };
        if (matricula) upd.link_matricula = matricula;
        if (fotoUrl) upd.link_foto = fotoUrl;
        const { error } = await supabase.from('imoveis_leilao').update(upd).eq('id', imovelId);
        if (error) { erro++; console.log(`- sodre_${lid}: erro gravar ${error.message}`); continue; }
        ok++; console.log(`✓ sodre_${lid}: ${anexos.length} doc(s) [${anexos.map(a => a.tipo).join(',')}]${matricula ? ' +matrícula' : ''}${fotoUrl ? ' +foto' : ''}`);
      } catch (e) { erro++; console.log(`- sodre_${lid}: erro ${e.message}`); }
    }
    console.log(`\nSODRE — resultado: ${ok} enriquecido(s) · ${semMap} fora do search-lots · ${semDoc} sem PDF · ${erro} erro(s).`);
  } finally { await browser.close().catch(() => {}); }
  console.log('Fim.');
}
main().catch(e => { console.error(e); process.exit(1); });
