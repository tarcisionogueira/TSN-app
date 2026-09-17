// TEMPORÁRIO — recon do ALBERTOMACEDOLEILOES: o dono reportou que
// https://www.albertomacedoleiloes.com.br/lote/2-lote-residencial-buri-residence não aparece
// no sistema mesmo com o scraper configurado. Hipótese (leitura de código): o parser
// (scripts/lib/albertomacedo-parse.mjs) só reconhece URLs /leilao/<slug> — o padrão /lote/N-slug
// é estruturalmente invisível pro `extrairUrlsDeLote` atual. Este recon NÃO grava nada; só
// confirma (a) se a URL do lote é uma página real e dissecta os campos, (b) de onde ela é
// linkada (home direto, ou só de dentro de uma página /leilao/<slug> pacote).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://www.albertomacedoleiloes.com.br';
const LOTE_URL = process.env.LOTE_URL || `${BASE}/lote/2-lote-residencial-buri-residence`;

async function buscar(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  const html = await r.text();
  return { status: r.status, html };
}

function textoDe(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linksInternos(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.host.includes('albertomacedoleiloes.com.br')) out.set(u.pathname, u.href);
    } catch { /* skip */ }
  }
  return [...out.values()];
}

async function main() {
  console.log(`🔎 RECON — ALBERTOMACEDOLEILOES /lote/ vs /leilao/\n`);

  console.log(`1) Abrindo direto a URL do lote reportada: ${LOTE_URL}`);
  const det = await buscar(LOTE_URL);
  console.log(`  status: ${det.status} · html: ${det.html.length} chars`);
  if (det.status === 200) {
    const txt = textoDe(det.html);
    console.log(`  texto visível (1500 chars): "${txt.slice(0, 1500)}"`);
    console.log(`  tem "Avaliação"? ${/Avalia[çc][ãa]o/i.test(txt)}`);
    console.log(`  tem "matrícula"? ${/matr[íi]cula/i.test(txt)}`);
    console.log(`  tem tabela de praça (PRAÇA/ABERTURA/ENCERRAMENTO)? ${/pra[çc]a/i.test(txt)}`);
    const pdfs = [...det.html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map(m => m[1]);
    console.log(`  PDFs no HTML: ${pdfs.length}`);
    for (const p of pdfs.slice(0, 5)) console.log(`    ${p}`);
  } else {
    console.log('  ⚠️ não voltou 200 — pode ser rate-limit por sessão (mesma assinatura já vista na JELEILOES/albertomacedo em outras rotas). Testar de novo isolado se necessário.');
  }

  console.log(`\n2) Abrindo a HOME (${BASE}/) — /lote/ aparece linkado direto?`);
  const home = await buscar(`${BASE}/`);
  console.log(`  status: ${home.status} · html: ${home.html.length} chars`);
  const linksHome = linksInternos(home.html, BASE);
  const loteNaHome = linksHome.filter(u => /\/lote\//i.test(u));
  const leilaoNaHome = linksHome.filter(u => /\/leilao\//i.test(u));
  console.log(`  ${linksHome.length} links internos · ${loteNaHome.length} com /lote/ · ${leilaoNaHome.length} com /leilao/`);
  for (const l of loteNaHome.slice(0, 10)) console.log(`    /lote/: ${l}`);
  for (const l of leilaoNaHome.slice(0, 10)) console.log(`    /leilao/: ${l}`);

  // 3) Se achou um /leilao/<slug> que pareça ser o pacote "buri residence", abre e procura /lote/ dentro.
  const candidatoPacote = leilaoNaHome.find(u => /buri/i.test(u)) || leilaoNaHome[0];
  if (candidatoPacote) {
    console.log(`\n3) Abrindo candidato a página PACOTE: ${candidatoPacote}`);
    const pac = await buscar(candidatoPacote);
    console.log(`  status: ${pac.status} · html: ${pac.html.length} chars`);
    const linksPacote = linksInternos(pac.html, BASE);
    const loteNoPacote = linksPacote.filter(u => /\/lote\//i.test(u));
    console.log(`  /lote/ encontrados DENTRO desta página pacote: ${loteNoPacote.length}`);
    for (const l of loteNoPacote.slice(0, 15)) console.log(`    ${l}`);
    const txtPac = textoDe(pac.html);
    console.log(`  texto visível do pacote (800 chars): "${txtPac.slice(0, 800)}"`);
  } else {
    console.log('\n3) Nenhum /leilao/ encontrado na home pra testar como pacote.');
  }

  // 4) Sitemap, se existir — forma barata de mapear TODOS os /lote/ existentes de uma vez.
  console.log(`\n4) Testando /sitemap.xml`);
  const sm = await buscar(`${BASE}/sitemap.xml`);
  console.log(`  status: ${sm.status} · tamanho: ${sm.html.length}`);
  if (sm.status === 200) {
    const urlsSitemap = [...sm.html.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1]);
    const loteSitemap = urlsSitemap.filter(u => /\/lote\//i.test(u));
    console.log(`  ${urlsSitemap.length} URLs no sitemap · ${loteSitemap.length} são /lote/`);
    for (const l of loteSitemap.slice(0, 10)) console.log(`    ${l}`);
  }

  console.log('\n═══ FIM DO RECON');
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
