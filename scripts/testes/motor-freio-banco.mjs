// FREIO DO BANCO NO MOTOR DE FETCH (23/10, LEILAOELETRONICO): o banco serviu o feed (direto marcado
// inútil), falhou 2× nas páginas e era desligado pelo resto da rodada — sem caminho nenhum, 118 de 118
// lotes "sem detalhe" em 4 s. Agora: pausa curta e nova tentativa. Rede e relógio simulados (sem espera real).
import assert from 'node:assert/strict';

process.env.VITE_SUPABASE_URL = 'https://banco.teste';
process.env.SUPABASE_SERVICE_KEY = 'chave-teste';
let agora = 1_000_000;
Date.now = () => agora;
globalThis.setTimeout = (fn, ms = 0) => { agora += ms; queueMicrotask(fn); return 0; };
globalThis.clearTimeout = () => {};

let bancoFalhasRestantes = 0;
const chamadas = { direto: 0, banco: 0 };
let id = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://banco.teste/rest/v1/rpc/pagina_pedir')) {
    chamadas.banco++;
    if (bancoFalhasRestantes > 0) { bancoFalhasRestantes--; return new Response('erro', { status: 500 }); }
    return Response.json(++id);
  }
  if (u.startsWith('https://banco.teste/rest/v1/rpc/pagina_ler')) {
    return Response.json([{ pronto: true, status: 200, conteudo: '<html><body>lote ok</body></html>' }]);
  }
  chamadas.direto++;
  return new Response('negado', { status: 403 }); // o site recusa o IP do runner
};

const { criarMotorFetch } = await import('../lib/motor/fetch-fonte.mjs');
const { fetchFonte } = criarMotorFetch('teste');
const H = 'https://www.leilaoeletronico.com.br';

// feed pelo banco → o direto passa a ser pulado neste host
assert.equal((await fetchFonte(`${H}/sitemap.xml`, { semBD: true })).via, 'banco');
// duas falhas passageiras do banco
bancoFalhasRestantes = 2;
assert.equal((await fetchFonte(`${H}/lote/a/1/`, { semBD: true })).html, null);
assert.equal((await fetchFonte(`${H}/lote/b/2/`, { semBD: true })).html, null);
// antes: banco desligado + direto pulado = TODAS as próximas páginas sem detalhe. Agora espera a pausa e volta.
for (let i = 3; i < 8; i++) {
  const r = await fetchFonte(`${H}/lote/x/${i}/`, { semBD: true });
  assert.equal(r.via, 'banco', `página ${i} deveria vir pelo banco depois da pausa`);
}

// host em que o banco NUNCA serve: a pausa cresce e não paga 2 tentativas do banco por página
const { fetchFonte: f2 } = criarMotorFetch('teste');
bancoFalhasRestantes = 1e9;
const antes = chamadas.banco;
for (let i = 0; i < 30; i++) await f2(`https://outro.host/lote/${i}`, { semBD: true });
assert.ok(chamadas.banco - antes < 15, `banco tentado ${chamadas.banco - antes}× em 30 páginas`);

console.log('✓ motor: freio do banco pausa e volta; host sem banco não é martelado');
