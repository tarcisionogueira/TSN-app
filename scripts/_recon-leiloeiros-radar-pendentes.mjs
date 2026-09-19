// RECON DESCARTÁVEL (19/09) — leiloeiros NOVOS apontados pelo radar de editais, ainda sem
// investigação nesta sessão. Fetch GRÁTIS (sem proxy, sem Bright Data) — só pra saber se o
// domínio responde e qual plataforma é (mesmo método de triagem do scraper-soleon.mjs: `home`
// primeiro, decide por assinatura, só then investe recurso pago se vale a pena).
const ALVOS = [
  'https://leilaobrasil.com.br',
  'https://dilsonmoreira.com.br',
  'https://lut.com.br',
  'https://gpleiloes.com.br',
  'https://neteditais.com.br',
  'https://lutheroleiloes.com.br',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function assinatura(html) {
  const h = html.toLowerCase();
  const sinais = [];
  if (h.includes('soleon')) sinais.push('SOLEON');
  if (h.includes('leilotech') || /go\/graphql/.test(h)) sinais.push('LeiloTech');
  if (h.includes('superbid')) sinais.push('Superbid');
  if (h.includes('leilaopro') || h.includes('leilao pro')) sinais.push('LeilãoPro');
  if (h.includes('sold leiloes') || h.includes('soldleiloes')) sinais.push('Sold');
  if (/just a moment|cf-chl|cf-mitigated|attention required/i.test(html.slice(0, 4000))) sinais.push('CLOUDFLARE-CHALLENGE');
  if (h.includes('wordpress') || h.includes('wp-content')) sinais.push('WordPress-generico');
  return sinais.length ? sinais.join('+') : '(sem assinatura conhecida)';
}

for (const url of ALVOS) {
  console.log(`\n=== ${url} ===`);
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow' });
    clearTimeout(t);
    const html = await r.text().catch(() => '');
    console.log(`status=${r.status} · bytes=${html.length} · url_final=${r.url} · plataforma=${assinatura(html)}`);
    // Procura link de listagem óbvio (lotes/imoveis/leiloes) no HTML.
    const links = [...html.matchAll(/href=["']([^"']*(?:lote|imov|leil|bem)[^"']*)["']/gi)].map(m => m[1]).slice(0, 8);
    if (links.length) console.log(`  candidatos a listagem: ${links.join(' | ')}`);
    // Título da página, pra contexto rápido.
    const titulo = (html.match(/<title>([^<]*)<\/title>/i) || [])[1];
    if (titulo) console.log(`  <title>: ${titulo.trim().slice(0, 150)}`);
  } catch (e) {
    console.log(`FALHOU: ${String(e.message || e).slice(0, 200)}`);
  }
}
console.log('\n✅ recon concluído.');
