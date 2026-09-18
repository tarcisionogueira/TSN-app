// Teste DESCARTÁVEL (18/09) — valida se o proxy ISP do Bright Data resolve o bloqueio de IP
// de DATACENTER no HASTA (hastaleiloes.com.br), sem depender do runner residencial (IP de
// casa do dono). Roda pela workflow `_temp-teste-proxy-isp-hasta.yml` — GitHub Actions É
// datacenter, o mesmo ambiente que hoje bloqueia; se o proxy resolver AQUI, HASTA (e o mesmo
// remédio serve para RJ/PECINI/GESTAO/GLOBOLEILOES) deixa de depender da máquina de casa.
//
// Não grava nada no banco — só reporta o que encontrou.
// Uso: node scripts/_teste-proxy-isp-hasta.mjs (exige BRIGHTDATA_ISP_HOST/USER/PASS no ambiente)
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { proxyIspDisponivel } from './lib/motor/proxy-isp.mjs';

if (!proxyIspDisponivel()) {
  console.error('BRIGHTDATA_ISP_HOST/USER/PASS ausentes — configure antes de rodar este teste.');
  process.exit(1);
}

const ALVOS = [
  { nome: 'HASTA (home)', url: 'https://hastaleiloes.com.br/' },
  { nome: 'HASTA (/leiloes)', url: 'https://hastaleiloes.com.br/leiloes' },
];

const motor = criarMotorDom({ esperaMs: 3500, timeoutMs: 45000, usarProxyIsp: true });

for (const { nome, url } of ALVOS) {
  console.log(`\n══════ ${nome} — ${url} ══════`);
  const { html, via } = await motor.fetchFonte(url);
  if (!html) { console.log(`  → null (via=${via}) — proxy NÃO resolveu, ou erro (ver log acima)`); continue; }
  const temRS = (html.match(/R\$\s?[\d.]+,\d{2}/g) || []).slice(0, 8);
  const temLote = [...new Set((html.match(/\/(?:lote|item|leilao)[^"'\s)]{0,60}/gi) || []))].slice(0, 10);
  console.log(`  → HTML ${html.length} bytes (via=${via})`);
  console.log(`  valores R$ encontrados: ${JSON.stringify(temRS)}`);
  console.log(`  links de lote/leilão: ${JSON.stringify(temLote)}`);
}

await motor.fechar();
console.log('\n✅ teste concluído — se o HTML trouxe conteúdo real (valores R$ e/ou links de lote), o proxy resolveu o bloqueio.');
