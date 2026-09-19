/**
 * Recon DESCARTÁVEL (19/09) — testa se o proxy ISP do Bright Data (validado hoje contra o
 * HASTA, PR #350) resolve o bloqueio Cloudflare do FERNANDOLEILOEIRO e JONASLEILOEIRO.
 *
 * Contexto: são os leiloeiros com MAIS editais no radar (19 e 3 em 45 dias) ainda não
 * integrados. Testados antes (scripts/_teste-residencial-cloudflare-bloqueados.mjs) via IP
 * RESIDENCIAL + Bright Data Web Unlocker — ambos sem sucesso. O proxy ISP é uma variável nova,
 * nunca tentada contra Cloudflare (só contra bloqueio de reputação de IP puro, como o HASTA).
 *
 * NÃO grava nada — só reporta o que encontrou. Uso: node scripts/recon-fernando-jonas-via-proxy.mjs
 */
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { proxyIspDisponivel } from './lib/motor/proxy-isp.mjs';

if (!proxyIspDisponivel()) {
  console.error('BRIGHTDATA_ISP_HOST/USER/PASS ausentes — configure antes de rodar este recon.');
  process.exit(1);
}

const ALVOS = [
  { nome: 'FERNANDOLEILOEIRO (home)', url: 'https://fernandoleiloeiro.com.br/' },
  { nome: 'FERNANDOLEILOEIRO (busca)', url: 'https://fernandoleiloeiro.com.br/busca/#Engine=Start&ID_Categoria=2' },
  { nome: 'JONASLEILOEIRO (home)', url: 'https://jonasleiloeiro.com.br/' },
];

const motor = criarMotorDom({ esperaMs: 6000, timeoutMs: 45000, usarProxyIsp: true });

for (const { nome, url } of ALVOS) {
  console.log(`\n══════ ${nome} — ${url} ══════`);
  const { html, via } = await motor.fetchFonte(url);
  if (!html) { console.log(`  → null (via=${via}) — falhou`); continue; }
  const desafio = /just a moment|checking your browser|cf-browser-verification|cloudflare/i.test(html);
  const temRS = (html.match(/R\$\s?[\d.]+,\d{2}/g) || []).slice(0, 6);
  const temLinks = [...new Set((html.match(/href=["'][^"']*(?:lote|imovel|leilao|item)[^"']*["']/gi) || []))].slice(0, 8);
  console.log(`  → HTML ${html.length} bytes (via=${via}) — sinal de desafio Cloudflare: ${desafio}`);
  console.log(`  valores R$ encontrados: ${JSON.stringify(temRS)}`);
  console.log(`  links de lote/imóvel: ${JSON.stringify(temLinks)}`);
}

await motor.fechar();
console.log('\n✅ teste concluído — se veio conteúdo real (R$/links) sem sinal de desafio, o proxy resolveu o bloqueio.');
