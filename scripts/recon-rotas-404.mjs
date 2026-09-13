#!/usr/bin/env node
/**
 * RECON — o dono reportou 404 (NOT_FOUND, plataforma Vercel) ao abrir DIRETO
 * /membros e /membros/ebook/<id> em bidprobrasil.com.br. `vercel.json` não tem
 * nenhum rewrite catch-all pra servir index.html em rotas client-side — testa se é
 * isso (todas as rotas SPA 404 na Vercel) ou algo mais específico dessas duas.
 * Só leitura, não grava nada.
 *
 * Uso: node scripts/recon-rotas-404.mjs
 */
const BASE = 'https://bidprobrasil.com.br';
const ROTAS = ['/', '/membros', '/membros/ebook/5c78ab35-9810-48b2-8801-16d50bc94f50', '/login', '/busca', '/planos', '/cadastro'];

async function checar(url, salto = 0) {
  const res = await fetch(url, { redirect: 'manual' });
  const txt = await res.text();
  const loc = res.headers.get('location');
  const ehVercel404 = /404: NOT_FOUND|This deployment cannot be found/i.test(txt);
  const ehIndexHtml = /<div id="root">|<script type="module"/i.test(txt);
  const prefixo = '  '.repeat(salto);
  console.log(`${prefixo}[${res.status}] ${url} — vercel404=${ehVercel404} indexHtml=${ehIndexHtml} (${txt.length} bytes)${loc ? ` -> ${loc}` : ''}`);
  if (loc && res.status >= 300 && res.status < 400 && salto < 5) {
    const proxima = new URL(loc, url).toString();
    await checar(proxima, salto + 1);
  }
}

async function main() {
  for (const rota of ROTAS) {
    try {
      await checar(`${BASE}${rota}`);
    } catch (e) {
      console.log(`  ${rota}: erro ${String(e?.message || e).slice(0, 120)}`);
    }
  }
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
