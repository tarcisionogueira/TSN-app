/**
 * Recon DESCARTÁVEL (18/09) — mapeia a estrutura real do HASTA (hastaleiloes.com.br) atrás do
 * proxy ISP do Bright Data, de IP de DATACENTER (GitHub Actions) — confirmado em
 * _teste-proxy-isp-hasta.mjs que o proxy resolve o bloqueio que este site aplica a datacenter.
 *
 * OBJETIVO: achar uma via mais BARATA que renderizar Chromium inteiro a cada lote — mesmo
 * raciocínio de "usa o caminho leve quando dá, só recorre ao pesado quando precisa" que já rege
 * Bright Data × residencial nas outras fontes (ver CLAUDE.md). Duas perguntas:
 *   (1) O HTML cru (sem JS) já vem populado? Se sim, plain fetch/curl basta — sem Chromium.
 *   (2) A SPA busca os lotes numa API JSON por trás? Se sim, dá pra chamar a API direto.
 *
 * Fase 1 — curl --proxy (sem navegador) em /, /leiloes e um /leilao/<id>/lotes.
 * Fase 2 — Chromium com o proxy, escutando toda resposta JSON via CDP enquanto navega os
 *          mesmos 3 níveis (/leiloes → /leilao/<id>/lotes → /item/<ID>/detalhes).
 *
 * NÃO grava nada — só imprime achados. Uso: node scripts/recon-hasta-via-proxy.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer';
import { proxyIspDisponivel, proxyIspServidor, proxyIspCredenciais } from './lib/motor/proxy-isp.mjs';

const execFileP = promisify(execFile);
const BASE = 'https://hastaleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

if (!proxyIspDisponivel()) {
  console.error('BRIGHTDATA_ISP_HOST/USER/PASS ausentes — configure antes de rodar este recon.');
  process.exit(1);
}

async function curlCru(url) {
  const { username, password } = proxyIspCredenciais();
  try {
    const { stdout } = await execFileP('curl', [
      '-sS', '-m', '25', '--proxy', proxyIspServidor(), '--proxy-user', `${username}:${password}`,
      '-A', UA, '-o', '-', '-w', '\n__STATUS__%{http_code}', url,
    ]);
    const idx = stdout.lastIndexOf('__STATUS__');
    return { status: idx >= 0 ? stdout.slice(idx + 10).trim() : '?', body: idx >= 0 ? stdout.slice(0, idx) : stdout };
  } catch (e) {
    return { status: 0, body: '', err: String(e.message || e).slice(0, 200) };
  }
}

console.log('══════ FASE 1 — HTML cru via proxy (sem navegador) ══════');
for (const path of ['/', '/leiloes']) {
  const { status, body, err } = await curlCru(BASE + path);
  const lotes = [...new Set([...body.matchAll(/\/leilao\/(\d+)\/lotes/gi)].map(m => m[0]))];
  const temRS = (body.match(/R\$\s?[\d.]+,\d{2}/g) || []).length;
  console.log(`${path} → status=${status} len=${body.length} leilões-encontrados=${lotes.length} R$-encontrados=${temRS}${err ? ` ERRO=${err}` : ''}`);
}
console.log('(se leilões-encontrados/R$ vierem 0 acima mas o Chromium abaixo achar conteúdo, confirma que precisa de JS — SPA de verdade)');

console.log('\n══════ FASE 2 — Chromium com proxy, escutando respostas JSON ══════');
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', `--proxy-server=${proxyIspServidor()}`],
});
const page = await browser.newPage();
await page.authenticate(proxyIspCredenciais());
await page.setUserAgent(UA);

const jsonVistos = [];
page.on('response', async (res) => {
  try {
    const ct = res.headers()['content-type'] || '';
    if (!/json/i.test(ct)) return;
    const url = res.url();
    const txt = await res.text().catch(() => '');
    jsonVistos.push({ url, tamanho: txt.length, amostra: txt.slice(0, 300) });
    console.log(`  [API] ${url.slice(0, 140)} (${txt.length}b)`);
  } catch { /* espião nunca derruba a navegação */ }
});

async function ir(url, esperaMs = 3500) {
  console.log(`\n→ navegando ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(e => console.log(`   falha: ${e.message.slice(0, 120)}`));
  await new Promise(r => setTimeout(r, esperaMs));
  return page.content();
}

const homeHtml = await ir(BASE + '/leiloes');
const leilaoIds = [...new Set([...homeHtml.matchAll(/\/leilao\/(\d+)\/lotes/gi)].map(m => m[1]))];
console.log(`\nleilões achados no /leiloes renderizado: ${leilaoIds.length} — amostra: ${JSON.stringify(leilaoIds.slice(0, 5))}`);

if (leilaoIds[0]) {
  const lotesHtml = await ir(`${BASE}/leilao/${leilaoIds[0]}/lotes`);
  const itemIds = [...new Set([...lotesHtml.matchAll(/\/item\/(\d+)\/detalhes/gi)].map(m => m[1]))];
  console.log(`itens achados em /leilao/${leilaoIds[0]}/lotes: ${itemIds.length} — amostra: ${JSON.stringify(itemIds.slice(0, 5))}`);

  if (itemIds[0]) {
    const detalheHtml = await ir(`${BASE}/item/${itemIds[0]}/detalhes`);
    const temRS = (detalheHtml.match(/R\$\s?[\d.]+,\d{2}/g) || []).slice(0, 6);
    console.log(`detalhe /item/${itemIds[0]}/detalhes: ${detalheHtml.length} bytes, R$ encontrados: ${JSON.stringify(temRS)}`);
  }
}

await browser.close();

console.log(`\n══════ RESUMO ══════`);
console.log(`Endpoints JSON distintos vistos: ${new Set(jsonVistos.map(j => j.url.split('?')[0])).size}`);
if (jsonVistos.length === 0) {
  console.log('Nenhuma resposta JSON capturada — a SPA provavelmente monta tudo via SSR/hidratação sem API JSON separada (ou a API é same-document/RSC, não XHR/fetch). Full Chromium continua sendo o caminho.');
} else {
  console.log('Endpoints JSON encontrados (avalie se dá pra chamar direto, sem Chromium):');
  for (const j of jsonVistos) console.log(`  - ${j.url}`);
}
