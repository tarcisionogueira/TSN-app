// Teste DESCARTÁVEL (19/09) — mesmo remédio do HASTA (18/09): o proxy ISP do Bright Data
// (produto separado do Web Unlocker, $2/IP/mês, já confirmado resolvendo bloqueio de
// REPUTAÇÃO DE IP de datacenter) combinado com Chromium real (executa JS) contra os 3 sites
// que nem o stealth grátis nem o Web Unlocker (fetch cru, sem JS) resolveram:
// crleiloes.com.br/leiloesuberlandia.com.br (rede "Plataforma Leiloar") e lucasleiloeiro.com.br.
//
// Diferença do teste anterior (Web Unlocker): aqui é um NAVEGADOR de verdade, então a SPA
// consegue rodar o AJAX que carrega a listagem completa — é isso que faltou nos dois testes
// anteriores (stealth sem proxy = navegador certo, IP errado; Web Unlocker = IP/desafio certo,
// sem navegador).
//
// Não grava nada no banco — só reporta o que encontrou.
// Uso: node scripts/_teste-proxy-isp-leiloar.mjs (exige BRIGHTDATA_ISP_HOST/USER/PASS)
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { proxyIspDisponivel } from './lib/motor/proxy-isp.mjs';

if (!proxyIspDisponivel()) {
  console.error('BRIGHTDATA_ISP_HOST/USER/PASS ausentes — configure antes de rodar este teste.');
  process.exit(1);
}

const ALVOS = [
  { nome: 'crleiloes.com.br', url: 'https://www.crleiloes.com.br/leiloes' },
  { nome: 'leiloesuberlandia.com.br', url: 'https://www.leiloesuberlandia.com.br/' },
  { nome: 'lucasleiloeiro.com.br', url: 'https://www.lucasleiloeiro.com.br/busca/#Engine=Start&Pagina=1&Busca=&Mapa=&ID_Categoria=88' },
];

const motor = criarMotorDom({ esperaMs: 5000, timeoutMs: 45000, usarProxyIsp: true });

for (const { nome, url } of ALVOS) {
  console.log(`\n══════ ${nome} — ${url} ══════`);
  const { html, via } = await motor.fetchFonte(url);
  if (!html) { console.log(`  → null (via=${via}) — proxy NÃO resolveu, ou erro (ver log acima)`); continue; }
  const temDesafio = /just a moment|verifying you are human|checking your browser/i.test(html);
  const loteCr = [...new Set((html.match(/\/lote\/\d+/g) || []))];
  const leilaoCr = [...new Set((html.match(/\/leilao\/\d+/g) || []))];
  const temRS = (html.match(/R\$\s?[\d.]+,\d{2}/g) || []).slice(0, 8);
  console.log(`  → HTML ${html.length} bytes (via=${via}) · desafio Cloudflare ainda presente: ${temDesafio}`);
  console.log(`  links /lote/N distintos: ${loteCr.length} · /leilao/N distintos: ${leilaoCr.length}`);
  console.log(`  valores R$ encontrados: ${JSON.stringify(temRS)}`);
}

await motor.fechar();
console.log('\n✅ teste concluído — se o HTML trouxe conteúdo real (links de lote/leilão distintos além dos ~19 destaques, e/ou valores R$), o proxy+navegador resolveu.');
