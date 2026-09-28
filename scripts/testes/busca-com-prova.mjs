// Busca de mercado no Claude que PROVA que buscou (api/_busca-com-prova.js) — respostas simuladas.
const fila = []; const pedidos = [];
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('anthropic')) return new Response('{}', { status: 200 });
  pedidos.push(JSON.parse(opts.body));
  return new Response(JSON.stringify(fila.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
};
const { buscarComProva } = await import('../../api/_busca-com-prova.js');
const degrau = { model: 'claude-haiku-4-5', ferramenta: (n) => ({ type: 'web_search_20250305', name: 'web_search', max_uses: n }) };
const semBusca = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Vou pesquisar...' }], usage: { input_tokens: 10, output_tokens: 400 } };
const comBusca = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"nivel1":{"vendas":[{"valorM2":5000}]}}' }], usage: { input_tokens: 10, output_tokens: 900, server_tool_use: { web_search_requests: 3 } } };
const pausa = { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 'x', name: 'web_search', input: {} }], usage: { input_tokens: 10, output_tokens: 50, server_tool_use: { web_search_requests: 1 } } };
const base = { degrau, chave: 'k', system: 's', prompt: 'p', webUses: 8, timeoutMs: 60000 };
let ok = 0, falha = 0; const eq = (n, a, b) => { const p = JSON.stringify(a) === JSON.stringify(b); p ? ok++ : falha++; if (!p) console.log('✗', n, a, b); };

fila.push(semBusca, comBusca); pedidos.length = 0;
let r = await buscarComProva(base);
eq('A: cobrou e buscou', [r.cobrou, r.buscas, pedidos.length], [true, 3, 2]);
eq('A: cobrança vai como user após o assistant', pedidos[1].messages.map((m) => m.role), ['user', 'assistant', 'user']);
eq('A: texto final é o JSON', r.texto.startsWith('{"nivel1"'), true);

fila.push(pausa, comBusca); pedidos.length = 0;
r = await buscarComProva(base);
eq('B: pause_turn continuado, sem cobrança', [r.pausas, r.cobrou, r.buscas, pedidos.length], [1, false, 4, 2]);

fila.push(semBusca, semBusca); pedidos.length = 0;
r = await buscarComProva(base);
eq('C: nunca buscou → buscas 0 após UMA cobrança', [r.buscas, r.cobrou, pedidos.length], [0, true, 2]);
console.log(`${falha ? '✗' : '✓'} busca-com-prova: ${ok} ok, ${falha} falha(s)`);
process.exit(falha ? 1 : 0);
