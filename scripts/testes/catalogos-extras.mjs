// enumerar() com `tenant.catalogosExtras` (16/11, EDUARDOVIVIAN): o site deixa /leilao/lotes/imoveis vazio e põe os
// imóveis em categorias próprias. Cada extra é lido; extra que não abre marca a lista como cortada (não "fonte fora").
import assert from 'node:assert/strict';
import { enumerar } from '../lib/motor/runner.mjs';

const lote = (id) => `<a href="/leilao/x-${id}/lote_id/${id}">l</a>`;
const cfg = {
  catalogo: '/leilao/lotes/imoveis', paginaParam: 'page_a',
  parse: { extrairUrlsDeLote: (html, base) => new Map([...html.matchAll(/lote_id\/(\d+)/g)].map((m) => [m[1], `${base}/l/${m[1]}`])) },
};
const paginas = {
  '/leilao/lotes/imoveis': '<p>vazio</p>',
  '/leilao/lotes/casas': lote(1) + lote(2),
  '/leilao/lotes/terrenos': lote(3),
};
const fake = async (url) => {
  const p = new URL(url).pathname;
  if (new URL(url).search) return { html: '<p></p>', via: 't' };
  return p in paginas ? { html: paginas[p], via: 't' } : { html: null, via: 'http-404' };
};
const base = 'https://x.test';

const r = await enumerar(fake, { fonte: 'T', base, catalogosExtras: ['/leilao/lotes/casas', '/leilao/lotes/terrenos'] }, cfg, { maxPages: 2 });
assert.equal(r.urls.length, 3, 'os 3 lotes das categorias extras entram');
assert.equal(r.cortada, null);

const r2 = await enumerar(fake, { fonte: 'T', base, catalogosExtras: ['/leilao/lotes/casas', '/leilao/lotes/sumiu'] }, cfg, { maxPages: 2 });
assert.match(String(r2.cortada), /sumiu/, 'extra que não abre marca a lista como cortada');

const r3 = await enumerar(fake, { fonte: 'T', base }, cfg, { maxPages: 2 });
assert.equal(r3.urls.length, 0, 'tenant sem extras: só o catálogo padrão, como antes');

console.log('✓ catalogos-extras: categorias próprias do tenant entram na enumeração');
