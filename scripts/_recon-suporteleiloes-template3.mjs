// RECON DESCARTÁVEL (19/09) — RODADA 3. Achado da rodada 2: a HOME lista ~230 eventos
// diretamente (/eventos/leilao/<id>/<slug>/lote), cada um redireciona (fetch com
// redirect:'follow') pro lote de detalhe REAL — não precisa sitemap nem paginação, a home É
// o catálogo. Falta o HTML CRU (não texto stripado) ao redor de cada rótulo, pra não repetir
// o erro já documentado nesta base (regex solto pegando menu/breadcrumb em vez do campo real).
const BASE = 'https://www.leilaobrasil.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function fetchTexto(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow' });
  clearTimeout(t);
  const txt = await r.text().catch(() => '');
  return { status: r.status, url: r.url, txt };
}

const det = await fetchTexto(`${BASE}/eventos/leilao/apartamento-no-butanta/lote/24171/apartamento-no-butanta`);
console.log(`status=${det.status} bytes=${det.txt.length} url_final=${det.url}`);
const html = det.txt;

function contexto(rotulo, janela = 350) {
  const idx = html.indexOf(rotulo);
  if (idx < 0) { console.log(`\n[${rotulo}] NÃO ACHADO NO HTML CRU`); return; }
  console.log(`\n[${rotulo}] @${idx}:`);
  console.log(html.slice(Math.max(0, idx - 60), idx + janela));
}

// <title> e meta og:*
console.log('=== <title> e meta og ===');
console.log((html.match(/<title>([^<]*)<\/title>/i) || [])[0]);
console.log((html.match(/<meta[^>]*property=["']og:title["'][^>]*>/i) || [])[0]);
console.log((html.match(/<meta[^>]*property=["']og:description["'][^>]*>/i) || [])[0]);
console.log((html.match(/<meta[^>]*property=["']og:image["'][^>]*>/i) || [])[0]);
console.log((html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i) || [])[0]);

for (const rotulo of ['COD.', 'Avalia', 'Leiloeiro', 'Comitente', 'Tipo</', '>Judicial', 'Matrícula n', 'EDITAL', 'Número do Processo', '1ª Leilão', 'São Paulo - SP']) {
  contexto(rotulo);
}

console.log('\n✅ recon rodada 3 concluído.');
