// Teste DESCARTÁVEL (19/09) — confirma se /bens/pesquisaAvancada/page:N do crleiloes.com.br
// (achado: paginação server-rendered, 12 lotes/página, SEM precisar de JS) responde com
// fetch cru (sem Puppeteer, sem proxy) também do GitHub Actions, não só do IP do Supabase
// (pg_net já confirmou sucesso, mas o runner de produção é outro IP/fingerprint).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function testar(pagina) {
  const url = `https://www.crleiloes.com.br/bens/pesquisaAvancada/page:${pagina}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  const html = await r.text();
  const desafio = /just a moment|verifying you are human/i.test(html);
  const lotes = [...new Set((html.match(/\/lote\/\d+/g) || []))];
  console.log(`page:${pagina} → HTTP ${r.status} · ${html.length} bytes · desafio: ${desafio} · lotes distintos: ${lotes.length} (${lotes.join(', ')})`);
}

for (const p of [1, 2, 3, 4]) await testar(p);
