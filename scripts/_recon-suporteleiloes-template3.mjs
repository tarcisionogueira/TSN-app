// RECON DESCARTÁVEL (19/09) — RODADA 5 (final). Achado: `var lote = {...}` no script #4 é
// um JSON válido com id/descricao/valores no topo, e objetos aninhados `bem` e `leilao`
// (que devem ter cidade/uf/endereco/matricula/comitente/leiloeiro/documentos/fotos). Esta
// rodada dumpa `lote.bem` e `lote.leilao` por completo.
const BASE = 'https://www.leilaobrasil.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function pegarLote(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow' });
  clearTimeout(t);
  const html = await r.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    if (!s[1].includes('valorAvaliacao')) continue;
    const m = s[1].match(/var\s+lote\s*=\s*(\{[\s\S]*\});/);
    if (!m) continue;
    try { return { lote: JSON.parse(m[1]), url: r.url }; } catch (e) { return { erro: String(e.message).slice(0, 200), url: r.url }; }
  }
  return { erro: 'script com var lote não achado', url: r.url };
}

const { lote, erro, url } = await pegarLote(`${BASE}/eventos/leilao/apartamento-no-butanta/lote/24171/apartamento-no-butanta`);
console.log(`url=${url}`);
if (erro) { console.log(`ERRO: ${erro}`); process.exit(0); }

console.log('\n=== lote.bem (chaves + valores, truncado) ===');
if (lote.bem && typeof lote.bem === 'object') {
  for (const [k, v] of Object.entries(lote.bem)) {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    console.log(`  ${k}: ${s.slice(0, 250)}`);
  }
} else console.log(`lote.bem = ${JSON.stringify(lote.bem)}`);

console.log('\n=== lote.leilao (chaves + valores, truncado) ===');
if (lote.leilao && typeof lote.leilao === 'object') {
  for (const [k, v] of Object.entries(lote.leilao)) {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    console.log(`  ${k}: ${s.slice(0, 250)}`);
  }
} else console.log(`lote.leilao = ${JSON.stringify(lote.leilao)}`);

console.log('\n=== outros campos de topo úteis ===');
for (const k of ['dataFechamento', 'dataLimiteLances', 'dataFechado', 'leiloes', 'numero', 'numeroString', 'status']) {
  console.log(`  ${k}: ${JSON.stringify(lote[k]).slice(0, 200)}`);
}

console.log('\n✅ recon rodada 5 concluído.');
