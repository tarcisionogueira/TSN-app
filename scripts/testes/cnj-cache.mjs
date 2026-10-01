// npm run testar:cnj-cache — o cache de consultas CNJ/DJEN guarda SÓ sucesso e poupa a 2ª consulta.
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL = 'https://sb.teste';
process.env.SUPABASE_SERVICE_KEY = 'chave-teste';
const { buscarDjen } = await import('../../api/_cnj.js');
let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
const NUM = '00012345620245050001';
const banco = new Map(); // chave → dados
const chamadas = { djen: 0, gravou: 0 };
let djenResponde = 500;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://sb.teste/rest/v1/cnj_consulta_cache')) {
    if ((opts.method || 'GET') === 'POST') { const b = JSON.parse(opts.body); banco.set(b.chave, b.dados); chamadas.gravou++; return new Response('', { status: 201 }); }
    const chave = decodeURIComponent(u.match(/chave=eq\.([^&]+)/)[1]);
    return Response.json(banco.has(chave) ? [{ dados: banco.get(chave) }] : []);
  }
  if (u.startsWith('https://sb.teste/rest/v1/rpc/')) return new Response('falha', { status: 500 }); // via banco também cai
  if (u.startsWith('https://comunicaapi.pje.jus.br')) {
    chamadas.djen++;
    if (djenResponde !== 200) return new Response('ocupado', { status: djenResponde });
    return Response.json({ count: 1, items: [{ data_disponibilizacao: '2026-09-10', siglaTribunal: 'TRT5', texto: 'Despacho' }] });
  }
  throw new Error('fetch inesperado: ' + u);
};
const espera = () => new Promise((r) => setTimeout(r, 30));

let r = await buscarDjen({ numero_processo: NUM }); await espera();
assert.ok(r.erro); assert.equal(chamadas.gravou, 0);
ok('DJEN "ocupado" → erro devolvido e NADA gravado no cache');

djenResponde = 200;
r = await buscarDjen({ numero_processo: NUM }); await espera();
assert.equal(r.total, 1); assert.equal(chamadas.gravou, 1);
ok('sucesso → resposta gravada no cache');

const antes = chamadas.djen;
r = await buscarDjen({ numero_processo: NUM });
assert.equal(r.total, 1); assert.equal(chamadas.djen, antes);
ok('2ª consulta do mesmo processo sai do cache, sem tocar no DJEN');
console.log(`\n✓ cnj-cache: ${n} casos`);
