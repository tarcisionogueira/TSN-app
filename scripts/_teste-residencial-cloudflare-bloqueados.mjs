// Teste DESCARTÁVEL — roda no runner RESIDENCIAL (IP de casa), NÃO na CI/Vercel.
//
// FERNANDOLEILOEIRO, JONASLEILOEIRO e GLOBOLEILOES (leiloeiro_conhecimento, 07-17/09) estão
// bloqueados pelo Cloudflare mesmo passando pelo Bright Data Web Unlocker — testado e
// confirmado sem sucesso nos três (Fernando/Jonas em 07/09 e 16/09; Globo em 17/09: 3
// tentativas via Unlocker devolveram HTTP 200 com corpo grande mas desafio intacto). Duas
// coisas NUNCA foram tentadas juntas nos três:
//   (a) IP RESIDENCIAL (o Cloudflare decide desafiar pela reputação do IP, não só pelo produto
//       usado — RJ/GESTAO/PECINI só passaram daqui, nunca do datacenter nem do Web Unlocker);
//   (b) um NAVEGADOR DE VERDADE executando o JS do site — o Web Unlocker devolve HTML, mas o
//       catálogo de Fernando/Jonas é uma SPA com hash-route (/busca/#Engine=Start&ID_Categoria=N)
//       e o do Globo é Inertia.js (data-page/XHR) — nenhum existe sem o JS do cliente rodar, e
//       nenhuma ferramenta HTTP-only alcança isso.
// Este script combina os dois: usa fetchHeadless() de fetch-residencial.mjs (Chromium real, o
// mesmo motor que já resolve RJ/GESTAO/PECINI/HASTA aqui). Só reporta o que encontrar — não
// grava nada no banco.
//
// Uso: node scripts/_teste-residencial-cloudflare-bloqueados.mjs
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';

const ALVOS = [
  { nome: 'FERNANDOLEILOEIRO', url: 'https://fernandoleiloeiro.com.br/busca/#Engine=Start&ID_Categoria=2' },
  { nome: 'FERNANDOLEILOEIRO (home)', url: 'https://fernandoleiloeiro.com.br/' },
  { nome: 'JONASLEILOEIRO', url: 'https://jonasleiloeiro.com.br/busca/#Engine=Start&ID_Categoria=2' },
  { nome: 'JONASLEILOEIRO (home)', url: 'https://jonasleiloeiro.com.br/' },
  { nome: 'GLOBOLEILOES (home)', url: 'https://globoleiloes.com.br/' },
  { nome: 'GLOBOLEILOES (/leiloes)', url: 'https://globoleiloes.com.br/leiloes' },
];

for (const { nome, url } of ALVOS) {
  console.log(`\n══════ ${nome} — ${url} ══════`);
  const html = await fetchHeadless(url, { timeoutMs: 45000, esperaMs: 6000 });
  if (!html) { console.log('  → null (Cloudflare não resolveu, ou erro — ver log acima)'); continue; }
  const temRS = (html.match(/R\$\s?[\d.]+,\d{2}/g) || []).slice(0, 8);
  const temLote = [...new Set((html.match(/\/(?:lote|imovel|leilao)[^"'\s)]{0,60}/gi) || []))].slice(0, 10);
  console.log(`  → HTML ${html.length} bytes`);
  console.log(`  valores R$ encontrados: ${JSON.stringify(temRS)}`);
  console.log(`  links de lote/imóvel: ${JSON.stringify(temLote)}`);
}
await fecharHeadless();
console.log('\n✅ teste concluído — se algum alvo mostrou valores R$/links de lote, dá pra escrever o parser.');
