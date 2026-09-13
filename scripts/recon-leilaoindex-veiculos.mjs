#!/usr/bin/env node
/**
 * RECON — antes de escrever o scraper de veículo do vendor "leilao/index" (13/09,
 * RIGOLONLEILOES/GIORDANOLEILOES/THAISTEIXEIRA). Só leitura, não grava nada.
 *
 * CORREÇÃO 13/09 (2ª rodada): a 1ª tentativa com `textoComLinhas` só mostrava as
 * primeiras ~10 linhas ÚTEIS (fora do banner de cookies OneTrust) — e o banner sozinho
 * tem MUITO mais que 10 linhas de texto (categorias, descrições, botões), então o corte
 * nunca alcançava o conteúdo real do lote. Em vez de imprimir linhas cruas (que dependem
 * de adivinhar quantas pular), busca SINAIS conhecidos (Avaliação/Lance mínimo — mesmos
 * rótulos que `valorPorRotulo` usa em produção — e palavras de categoria de veículo) no
 * texto FLATTENED inteiro (`textoDe`, a mesma função que os campos valor_avaliacao/
 * valor_minimo já usam hoje) e mostra o trecho ao redor de cada achado.
 *
 * Uso: node scripts/recon-leilaoindex-veiculos.mjs
 */
import puppeteer from 'puppeteer';
import { TENANTS, extrairUrlsDeLote } from './lib/leilaoindex-parse.mjs';
import { textoDe } from './lib/dom-parse-util.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ESPERA_MS = 3000;

const SINAIS = [
  ['Avaliação', /Avalia[çc][ãa]o/i],
  ['Lance mínimo', /Lance\s*m[íi]nimo/i],
  ['m² (imóvel)', /\bm[²2]\b/i],
  ['Matrícula (imóvel)', /matr[íi]cula/i],
  ['moto', /\bmoto(?:cicleta|neta)?s?\b/i],
  ['caminhão', /\bcaminh(?:[ãa]o|[õo]es)\b/i],
  ['carro/automóvel', /\bautom[óo]vel\b|\bcarro\b/i],
  ['placa (padrão)', /\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b|\b[A-Z]{3}-?\d{4}\b/],
  ['km rodado', /\bKM[:\s]*[\d.]{3,}/i],
];

async function visitar(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, ESPERA_MS));
    return await page.content();
  } catch (e) {
    console.log(`    erro ao visitar ${url}: ${String(e?.message || e).slice(0, 120)}`);
    return '';
  }
}

function mostrarSinais(txt) {
  for (const [nome, re] of SINAIS) {
    const m = txt.match(re);
    if (m) {
      const ini = Math.max(0, m.index - 60);
      const trecho = txt.slice(ini, m.index + m[0].length + 60).replace(/\s+/g, ' ').trim();
      console.log(`      [${nome}] ...${trecho}...`);
    }
  }
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const tenant of Object.values(TENANTS)) {
      console.log(`\n════ ${tenant.fonte} (${tenant.base}) ════`);
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setViewport({ width: 1366, height: 900 });
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

      const htmlHome = await visitar(page, tenant.base);
      const urls = [...extrairUrlsDeLote(htmlHome, tenant.base).values()];
      console.log(`  [/] ${urls.length} link(s) de lote na home`);

      for (const url of urls.slice(0, 3)) {
        console.log(`  ── ${url}`);
        const htmlDet = await visitar(page, url);
        if (!htmlDet) continue;
        const txt = textoDe(htmlDet);
        mostrarSinais(txt);
      }
      await page.close().catch(() => {});
    }
  } finally { await browser.close(); }
  console.log('\n✅ Recon concluído.');
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
