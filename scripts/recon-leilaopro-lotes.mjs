/**
 * Recon PROFUNDO LeilãoPro Core — dump da estrutura de card + detalhe p/ desenhar o parser.
 * Imprime: paginação, HTML cru de 2 cards da listagem, hrefs de lote, e o detalhe de 1 lote.
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE. Não grava nada.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
// leffa é o alvo grande; oscar migrou p/ oscar.leilao.br (recon anterior).
const ALVOS = (process.env.LEILAOPRO_ALVOS || 'https://www.leffaleiloes.com.br,https://www.oscar.leilao.br').split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bdFetch(url, timeoutMs = 60000) {
  try {
    const r = await fetch('https://api.brightdata.com/request', {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}

(async () => {
  for (const BASE of ALVOS) {
    console.log(`\n╔═══════════════ ${BASE} ═══════════════╗`);
    const L = await bdFetch(BASE + '/leilao/lotes/imoveis');
    console.log(`LISTAGEM → HTTP ${L.status} len=${L.body.length}`);
    const html = L.body;

    // 1) PAGINAÇÃO: links com ?pagina= / ?page= e rel=next; e "última página".
    const pag = [...new Set([...html.matchAll(/[?&](?:pagina|page)=(\d+)/gi)].map(m => Number(m[1])))].sort((a, b) => a - b);
    console.log(`\n[paginação] valores de pagina/page vistos: ${pag.join(',') || '(nenhum)'}`);
    const relNext = (html.match(/rel=["']next["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*rel=["']next["']/i) || []).slice(1).filter(Boolean)[0];
    if (relNext) console.log(`[paginação] rel=next → ${relNext}`);

    // 2) HREFS de lote individual (padrão /leilao/lote/... ou /lote/...).
    const hrefs = [...new Set([...html.matchAll(/href=["']([^"']*\/(?:leilao\/lote|lote|lotes)\/[^"'#]+)["']/gi)].map(m => m[1]))]
      .filter(h => !/\/lotes\/(veiculos|imoveis|maquinas|sucatas|animais|equipamentos|diversos|eletronicos|semoventes|implementos)/i.test(h));
    console.log(`\n[lotes] ${hrefs.length} href(s) de lote. Amostra:`);
    hrefs.slice(0, 6).forEach(h => console.log('   ' + h));

    // 3) HTML CRU de 1 card (bloco ao redor do 1º href de lote).
    if (hrefs.length) {
      const alvo = hrefs[0];
      const idx = html.indexOf(alvo);
      if (idx > 0) {
        const ini = html.lastIndexOf('<', Math.max(0, idx - 1200));
        const trecho = html.slice(Math.max(0, idx - 1200), idx + 900).replace(/\s+/g, ' ').trim();
        console.log(`\n[card cru] ao redor de ${alvo}:\n${trecho.slice(0, 1600)}`);
      }
    }

    // 4) DETALHE de 1 lote.
    if (hrefs.length) {
      const durl = hrefs[0].startsWith('http') ? hrefs[0] : BASE + hrefs[0];
      const D = await bdFetch(durl);
      console.log(`\n[detalhe] ${durl} → HTTP ${D.status} len=${D.body.length}`);
      const dtxt = D.body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // campos-chave por rótulo
      const acha = (re) => (dtxt.match(re) || [])[1];
      console.log('   título(h1):', (D.body.match(/<h1[^>]*>([\s\S]{0,140}?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      console.log('   R$ (primeiros 6):', (dtxt.match(/R\$\s?[\d.,]+/g) || []).slice(0, 6).join(' | '));
      console.log('   cidade/UF candidatos:', (dtxt.match(/[A-Za-zÀ-ú .]+\/[A-Z]{2}\b/g) || []).slice(0, 6).join(' | '));
      console.log('   área:', acha(/([\d.,]+\s*m²)/i));
      console.log('   datas:', (dtxt.match(/\d{2}\/\d{2}\/\d{4}(?:\s+\S+\s+\d{2}:\d{2})?/g) || []).slice(0, 6).join(' | '));
      console.log('   praça/leilão trecho:', (dtxt.match(/(1[ªa]?\s*pra[çc]a|2[ªa]?\s*pra[çc]a|leil[ãa]o|encerr)[^.]{0,80}/i) || [])[0]);
      console.log('   docs (edital/matrícula):', [...new Set([...D.body.matchAll(/href=["']([^"']*\.pdf[^"']*)["']/gi)].map(m => m[1]))].slice(0, 5).join(' | '));
      console.log('   trecho corpo (900c):', dtxt.slice(0, 900));
    }
  }
  console.log('\nFim. Usar os padrões acima p/ escrever lib/leilaopro-parse.mjs.');
})();
