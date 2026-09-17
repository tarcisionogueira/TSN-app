#!/usr/bin/env node
/**
 * TRAVA: os hashes de script inline na CSP (vercel.json) batem com o `index.html` atual?
 *
 * POR QUÊ (17/09): a CSP trocou de `unsafe-inline` para hash de cada `<script>` inline
 * (achado de auditoria de segurança — unsafe-inline/unsafe-eval enfraquecia a proteção
 * contra XSS). Hash é seguro, mas é FRÁGIL: se alguém editar um dos 3 `<script>` inline
 * do index.html (o redirect de /r/, o JSON-LD, ou o loader do gtag) sem recalcular o
 * hash, o navegador BLOQUEIA o script em produção — silenciosamente, sem erro visível
 * pra ninguém (é exatamente a classe de falha que este projeto já documentou várias
 * vezes: alguém muda um lado, o outro lado não sabe, e o sintoma só aparece pro
 * usuário/no painel de marketing dias depois). Esta trava fecha o buraco: falha o build
 * ANTES de chegar em produção, e diz exatamente qual hash trocar.
 *
 * Rodar sozinho: node scripts/verificar-csp-hashes.mjs
 * Recalcular os hashes (cole a saída no script-src do vercel.json):
 *   node scripts/verificar-csp-hashes.mjs --print
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PRINT = process.argv.includes('--print');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vercelRaw = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
const vercel = JSON.parse(vercelRaw);

// Mesma extração que o navegador vê: conteúdo de CADA <script> SEM src (inline de verdade).
const blocos = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1])
  .filter(c => c.trim().length > 0);

const hashDe = (conteudo) => 'sha256-' + createHash('sha256').update(conteudo, 'utf8').digest('base64');
const hashesAtuais = blocos.map(hashDe);

if (PRINT) {
  console.log('Hashes dos scripts inline do index.html (cole no script-src do vercel.json):\n');
  hashesAtuais.forEach((h, i) => console.log(`  ${i + 1}. '${h}'`));
  process.exit(0);
}

const cspHeader = (vercel.headers || [])
  .flatMap(h => h.headers || [])
  .find(h => h.key === 'Content-Security-Policy');

if (!cspHeader) {
  console.error('✗ verificar:csp — vercel.json não tem header Content-Security-Policy. Abortado.');
  process.exit(1);
}

const scriptSrc = (cspHeader.value.match(/script-src\s+([^;]+)/) || [])[1] || '';
const faltando = hashesAtuais.filter(h => !scriptSrc.includes(h));

if (faltando.length) {
  console.error(`✗ verificar:csp — ${faltando.length} script(s) inline do index.html SEM hash correspondente no script-src da CSP.`);
  console.error('  Isso faz o navegador BLOQUEAR o script em produção, sem erro visível (GTM/redirect/JSON-LD param de funcionar em silêncio).');
  console.error('  Rode `node scripts/verificar-csp-hashes.mjs --print`, copie os hashes que faltam pro script-src de vercel.json:');
  faltando.forEach(h => console.error(`    '${h}'`));
  process.exit(1);
}

console.log(`✓ CSP em dia — ${hashesAtuais.length} script(s) inline do index.html, todos com hash no script-src.`);
