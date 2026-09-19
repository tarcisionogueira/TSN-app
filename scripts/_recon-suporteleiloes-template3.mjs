// RECON DESCARTÁVEL (19/09) — RODADA 2. Rodada 1: nenhuma rota de catálogo adivinhada
// respondeu (sitemap/robots/eventos/leiloes/imoveis/busca/pesquisa deram 404 — só robots.txt
// existe e não é catálogo). O detalhe do lote 24171 é HTML server-rendered puro (sem
// __NEXT_DATA__/ld+json), com "Leilão ID 4512" distinto do slug da URL e um link "Voltar
// para o evento" — hipótese: o catálogo real é por EVENTO (como o HASTA), e a home lista
// tanto "anúncios" avulsos (1 imóvel = 1 evento, ex. apartamento-no-butanta) quanto eventos
// multi-lote (ex. "/eventos/leilao/4408/.../lote", achado na rodada 1 sem ID de lote).
// Esta rodada: (a) varre a HOME inteira por TODOS os hrefs "/eventos/leilao/...", pra separar
// os dois padrões; (b) pega o href real de "Voltar para o evento" no HTML cru do lote 24171;
// (c) tenta abrir a URL de evento multi-lote achada na rodada 1.
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

console.log('=== HOME: todos os hrefs /eventos/leilao/... ===');
const home = await fetchTexto(`${BASE}/`);
console.log(`status=${home.status} bytes=${home.txt.length}`);
const hrefs = [...home.txt.matchAll(/href=["'](\/eventos\/leilao\/[^"']+)["']/gi)].map(m => m[1]);
const unicos = [...new Set(hrefs)];
console.log(`total hrefs /eventos/leilao/: ${hrefs.length} (${unicos.length} únicos)`);
for (const h of unicos) console.log(`  ${h}`);

console.log('\n=== "Voltar para o evento" no HTML cru do lote 24171 ===');
const det = await fetchTexto(`${BASE}/eventos/leilao/apartamento-no-butanta/lote/24171/apartamento-no-butanta`);
const idx = det.txt.indexOf('Voltar para o evento');
if (idx >= 0) {
  console.log(det.txt.slice(Math.max(0, idx - 400), idx + 100));
} else {
  console.log('não achado no HTML cru (só no texto renderizado por JS?).');
}
// Também captura QUALQUER href de evento (sem "lote") dentro do próprio HTML do lote.
const hrefsNoLote = [...det.txt.matchAll(/href=["'](\/eventos\/leilao\/[^"']*?)["']/gi)].map(m => m[1]);
console.log('\nhrefs /eventos/leilao/ dentro da página do lote:');
for (const h of [...new Set(hrefsNoLote)]) console.log(`  ${h}`);

console.log('\n=== tentando abrir um evento MULTI-LOTE achado na rodada 1 ===');
const ev = await fetchTexto(`${BASE}/eventos/leilao/4408/predio-residencial-com-91-apartamentos-na-praia-grande/lote`);
console.log(`status=${ev.status} bytes=${ev.txt.length} url_final=${ev.url}`);
if (ev.status === 200) {
  const lotesDoEvento = [...new Set([...ev.txt.matchAll(/href=["'](\/eventos\/leilao\/[^"']*\/lote\/(\d+)[^"']*)["']/gi)].map(m => m[1]))];
  console.log(`lotes achados nesse evento: ${lotesDoEvento.length}`);
  for (const l of lotesDoEvento.slice(0, 10)) console.log(`  ${l}`);
}

await 0;
console.log('\n✅ recon rodada 2 concluído.');
