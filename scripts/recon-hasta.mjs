import { fetchUnlockerContado } from './lib/bd-ledger.mjs';
/**
 * Recon RUNTIME — hastaleilao.com.br (Flávio Costa, Vite SSR). Escolhido pelo probe: R$=31 no
 * HTML CRU, lote em /lote/<ID>/<slug> (agrega TRT-5/TJPE). Aqui: (1) enumera os /lote/ da home
 * (quantos, padrão), (2) disseca 1-2 detalhes (og:title/desc/image, contexto dos R$ p/ mapear
 * avaliação×lance, área, cidade/UF, praças, docs). NÃO grava. Env: BRIGHTDATA_API_TOKEN, ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const BASE = process.env.HASTA_BASE || 'https://www.hastaleilao.com.br';
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bd(url, timeoutMs = 40000) {
  try {
    const r = await fetchUnlockerContado({
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}
const og = (html, p) => (html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)["']`, 'i')) || [])[1] || '';

(async () => {
  const home = await bd(BASE + '/');
  console.log(`HOME ${home.status} len=${home.body.length}`);
  const lotes = [...new Set([...home.body.matchAll(/\/lote\/(\d+)\/([a-z0-9-]+)/gi)].map(m => m[0]))];
  console.log(`\nlotes na home: ${lotes.length} (únicos). Amostra:`);
  lotes.slice(0, 10).forEach(l => console.log('   ' + l));
  // Paginação? procura ?page / /pagina / rel=next
  const pag = [...new Set([...home.body.matchAll(/href=["']([^"']*(?:page=|pagina|p=)\d+[^"']*)["']/gi)].map(m => m[1]))].slice(0, 6);
  console.log(`\nsinais de paginação:`, JSON.stringify(pag));

  for (const rel of lotes.slice(0, 2)) {
    const url = BASE + rel;
    const d = await bd(url);
    console.log(`\n════ DETALHE ${rel} → ${d.status} len=${d.body.length} ════`);
    console.log('  og:title:', og(d.body, 'title'));
    console.log('  og:description:', og(d.body, 'description').slice(0, 200));
    console.log('  og:image:', og(d.body, 'image'));
    const txt = d.body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // Contexto de cada R$ (mapear rótulo: avaliação, 1ª/2ª praça, lance inicial...).
    console.log('  — R$ com contexto —');
    let n = 0;
    for (const m of txt.matchAll(/(.{0,45})R\$\s?([\d.]+,\d{2})/g)) {
      console.log(`     …${m[1].trim()} → R$ ${m[2]}`);
      if (++n >= 8) break;
    }
    // Sinais de área, cidade/UF, praça, modalidade, matrícula, docs.
    const grab = (re) => (txt.match(re) || [])[0] || '';
    console.log('  área:', grab(/[\d.]+,?\d*\s*m[²2]/i));
    console.log('  cidade/UF trecho:', grab(/(?:comarca|cidade|munic[íi]pio|em)\s+[A-ZÀ-Ú][^.,;]{2,40}\/?\s*[A-Z]{2}?/i));
    console.log('  praça/data:', grab(/(?:1[ªa]|2[ªa]|primeira|segunda)\s*(?:pra[çc]a|leil[ãa]o)[^.]{0,40}\d{1,2}\/\d{1,2}\/\d{4}/i) || grab(/\d{1,2}\/\d{1,2}\/20\d{2}/));
    console.log('  modalidade:', grab(/judicial|extrajudicial|venda\s*direta/i));
    console.log('  matrícula:', grab(/matr[íi]cula[^\d]{0,15}[\d.]{3,}/i));
    const pdfs = [...new Set([...d.body.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map(m => m[1]))].slice(0, 5);
    console.log('  PDFs:', JSON.stringify(pdfs));
  }
})();
