/**
 * scripts/testes/enumeracao-completa.mjs — #277 (22/10)
 *
 * A varredura de sumidos pela lista desliga lote ativo que NÃO está na enumeração. Isso só é
 * seguro se a lista foi lida INTEIRA: catálogo no teto de páginas, eventos cortados pelo
 * `maxEventos` ou evento que não abriu deixam lote do site fora da lista sem ele ter saído.
 * Este teste tranca o `completa` de `enumerar()` nesses casos.
 */
import { enumerar } from '../lib/motor/runner.mjs';

let falhas = 0;
const ok = (cond, oque) => { if (cond) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };

const tenant = { fonte: 'TESTE', base: 'https://x' };
const lotes = (...ids) => ids.map(i => `<a href="/lote/${i}">l</a>`).join('');
const parse = {
  extrairUrlsDeLote: (h) => new Map([...h.matchAll(/\/lote\/(\d+)/g)].map(m => [m[1], `https://x/lote/${m[1]}`])),
  idDaUrl: (u) => (u.match(/\/lote\/(\d+)/) || [])[1],
};
const fetchDe = (paginas) => async (url) => {
  const p = Number((url.match(/[?&]page=(\d+)/) || [])[1] || 1);
  return paginas[url.split('?')[0]]?.[p - 1] != null ? { html: paginas[url.split('?')[0]][p - 1], via: 'teste' } : { html: null };
};

// 1) catálogo de 2 páginas e a 3ª sem lote novo → completa
{
  const f = fetchDe({ 'https://x/cat': [lotes(1, 2), lotes(3), lotes(3)] });
  const r = await enumerar(f, tenant, { catalogo: '/cat', paginaParam: 'page', parse }, { maxPages: 5 });
  ok(r.urls.length === 3 && r.completa, 'catálogo que esgota antes do teto = completa');
}
// 2) teto de páginas batido ainda trazendo lote novo → cortada
{
  const f = fetchDe({ 'https://x/cat': [lotes(1), lotes(2), lotes(3)] });
  const r = await enumerar(f, tenant, { catalogo: '/cat', paginaParam: 'page', parse }, { maxPages: 2 });
  ok(!r.completa && /teto/.test(r.cortada || ''), 'teto de páginas com lote novo = incompleta');
}
// 3) eventos além do maxEventos → cortada
{
  const evs = (...ids) => ids.map(i => `<a href="/ev/${i}">e</a>`).join('');
  const cfg = {
    catalogo: '/cat', paginaParam: 'page', maxEventos: 1, maxPagesEvento: 2,
    parse: { ...parse, extrairUrlsDeEvento: (h) => new Map([...h.matchAll(/\/ev\/(\d+)/g)].map(m => [m[1], `https://x/ev/${m[1]}`])) },
  };
  const f = fetchDe({ 'https://x/cat': [evs(1, 2)], 'https://x/ev/1': [lotes(10), lotes(10)], 'https://x/ev/2': [lotes(20)] });
  const r = await enumerar(f, tenant, cfg, { maxPages: 1 });
  ok(!r.completa && /eventos/.test(r.cortada || ''), 'evento cortado pelo maxEventos = incompleta');
}
// 4) evento que não abre → cortada
{
  const evs = (...ids) => ids.map(i => `<a href="/ev/${i}">e</a>`).join('');
  const cfg = {
    catalogo: '/cat', paginaParam: 'page', maxEventos: 5, maxPagesEvento: 2,
    parse: { ...parse, extrairUrlsDeEvento: (h) => new Map([...h.matchAll(/\/ev\/(\d+)/g)].map(m => [m[1], `https://x/ev/${m[1]}`])) },
  };
  const f = fetchDe({ 'https://x/cat': [evs(1, 2)], 'https://x/ev/1': [lotes(10), lotes(10)] });
  const r = await enumerar(f, tenant, cfg, { maxPages: 1 });
  ok(!r.completa && /não abriu/.test(r.cortada || ''), 'evento que não abriu = incompleta');
}

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1); }
console.log('✓ enumeracao-completa: todos os casos passaram');
