// RECON DESCARTÁVEL (19/09) — mapeando o 3º template da infra "Suporte Leilões"
// (leilaobrasil.com.br + lutheroleiloes.com.br compartilham a mesma URL:
// /eventos/leilao/<slug>/lote/<id>/<slug>, confirmado no recon anterior via fetch direto).
// Objetivo: achar (a) uma listagem/catálogo real (sitemap ou página de busca) que enumere
// TODOS os lotes ativos, não só os poucos da home; (b) o HTML cru de 1 lote de detalhe pra
// mapear os rótulos (cidade/valor/matrícula/edital/foto/tipo/data).
const BASE = 'https://www.leilaobrasil.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function fetchTexto(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow' });
    clearTimeout(t);
    const txt = await r.text().catch(() => '');
    return { status: r.status, url: r.url, txt };
  } catch (e) {
    return { status: null, url, txt: '', erro: String(e.message || e).slice(0, 150) };
  }
}

console.log('=== candidatos a catálogo ===');
for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/robots.txt', '/eventos', '/leiloes', '/imoveis', '/busca', '/pesquisa', '/eventos/leilao']) {
  const r = await fetchTexto(BASE + path);
  console.log(`${path}: status=${r.status} bytes=${r.txt.length}${r.erro ? ' erro=' + r.erro : ''}`);
  if (r.status === 200 && path.includes('sitemap')) console.log(r.txt.slice(0, 2000));
  if (r.status === 200 && path === '/robots.txt') console.log(r.txt.slice(0, 1000));
}

console.log('\n=== detalhe de 1 lote (apartamento-no-butanta, id 24171) ===');
const det = await fetchTexto(`${BASE}/eventos/leilao/apartamento-no-butanta/lote/24171/apartamento-no-butanta`);
console.log(`status=${det.status} bytes=${det.txt.length} url_final=${det.url}`);
if (det.txt) {
  // Texto visível, pra ver rótulos de verdade.
  const texto = det.txt.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  console.log('\n--- texto visível (3000 chars) ---');
  console.log(texto.slice(0, 3000));
  // Links de PDF (edital/matrícula) e imagens candidatas.
  const pdfs = [...det.txt.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map(m => m[1]).slice(0, 10);
  console.log('\n--- PDFs achados ---');
  console.log(pdfs.join('\n'));
  const imgs = [...det.txt.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]).filter(s => !/logo|icon|favicon/i.test(s)).slice(0, 6);
  console.log('\n--- imagens candidatas ---');
  console.log(imgs.join('\n'));
  // JSON embutido (schema.org / __NEXT_DATA__ / estado inicial) — muitos sites SPA embutem
  // o JSON completo do lote numa tag <script>.
  const nextData = det.txt.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  const ldJson = [...det.txt.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  console.log(`\n--- __NEXT_DATA__ presente: ${!!nextData} · ld+json blocos: ${ldJson.length} ---`);
  if (ldJson.length) console.log(ldJson[0].slice(0, 1500));
}
console.log('\n✅ recon concluído.');
