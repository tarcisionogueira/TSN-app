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

async function main() {
  for (const rota of ROTAS) {
    try {
      const res = await fetch(`${BASE}${rota}`, { redirect: 'manual' });
      const txt = await res.text();
      const ehVercel404 = /404: NOT_FOUND|This deployment cannot be found/i.test(txt);
      const ehIndexHtml = /<div id="root">|<script type="module"/i.test(txt);
      console.log(`[${res.status}] ${rota} — vercel404=${ehVercel404} indexHtml=${ehIndexHtml} (${txt.length} bytes)`);
    } catch (e) {
      console.log(`  ${rota}: erro ${String(e?.message || e).slice(0, 120)}`);
    }
  }
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
