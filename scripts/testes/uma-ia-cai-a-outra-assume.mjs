// "Se uma IA parar, a outra assume, nos dois sentidos" (30/09). Fetch simulado — sem rede, sem custo.
// Prova: (1) Claude sem crédito/chave/fora → Gemini responde, com PDF e system (aprendizado) juntos;
// (2) erro do PEDIDO não troca de IA; (3) 'estrito' (A/B) nunca troca; (4) busca na web vira
// google_search e devolve a contagem que _busca-com-prova exige; (5) Gemini fora → Claude responde
// em iaTexto; (6) ferramenta própria não é emulada (fica a resposta do Claude).
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'teste';
process.env.CLAUDE_KEY = 'teste';
delete process.env.SUPABASE_SERVICE_KEY; // medição vira no-op

let cenario = {}; const chamadas = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('anthropic.com')) {
    chamadas.push({ ia: 'claude' });
    const { status, corpo } = cenario.claude;
    if (status === 'rede') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(corpo || {}), { status, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('generativelanguage')) {
    const body = JSON.parse(opts.body);
    chamadas.push({ ia: 'gemini', body });
    if (cenario.gemini === 'fora') return new Response('{"error":{"code":402}}', { status: 402 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: cenario.gemini === 'corta' ? 'MAX_TOKENS' : 'STOP', groundingMetadata: { webSearchQueries: ['a', 'b'] } }] }), { status: 200 });
  }
  throw new Error('url inesperada ' + u);
};

const { anthropicFetch, iaTexto } = await import('../../api/_claude.js');
const pedido = (extra = {}) => ({ method: 'POST', headers: {}, body: JSON.stringify({ model: 'x', max_tokens: 100, system: 'APRENDIZADO: lição X', messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } }, { type: 'text', text: 'leia' }] }], ...extra }) });
const rodar = async (c, extra, opts) => { cenario = c; chamadas.length = 0; return anthropicFetch(pedido(extra), { retries: 0, baseDelay: 1, ...opts }); };

// 1) falha do provedor → Gemini, levando PDF + system
for (const claude of [{ status: 402 }, { status: 401 }, { status: 400, corpo: { error: { message: 'Your credit balance is too low' } } }, { status: 529 }, { status: 'rede' }]) {
  const r = await rodar({ claude });
  assert.equal(r.headers.get('x-ia-provedor'), 'gemini', `Claude ${claude.status} deveria cair no Gemini`);
  const g = chamadas.find((c) => c.ia === 'gemini').body;
  assert.equal(g.contents[0].parts[0].inline_data.mime_type, 'application/pdf', 'o PDF tem que ir junto');
  assert.match(g.systemInstruction.parts[0].text, /lição X/, 'o aprendizado (system) tem que ir junto');
}
// noFallback: true (legado) não bloqueia mais
assert.equal((await rodar({ claude: { status: 402 } }, {}, { noFallback: true })).headers.get('x-ia-provedor'), 'gemini');

// 2) erro do pedido não troca
assert.equal((await rodar({ claude: { status: 400, corpo: { error: { message: 'messages: invalid' } } } })).status, 400);
assert.ok(!chamadas.some((c) => c.ia === 'gemini'), '400 comum não chama o Gemini');

// 3) estrito nunca troca
assert.equal((await rodar({ claude: { status: 402 } }, {}, { noFallback: 'estrito' })).status, 402);
assert.ok(!chamadas.some((c) => c.ia === 'gemini'));

// 4) busca na web
const rb = await rodar({ claude: { status: 402 } }, { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] });
const jb = await rb.json();
assert.equal(jb.usage.server_tool_use.web_search_requests, 2, 'contagem de buscas = prova');
assert.deepEqual(chamadas.find((c) => c.ia === 'gemini').body.tools, [{ google_search: {} }]);
assert.equal((await (await rodar({ claude: { status: 402 }, gemini: 'corta' })).json()).stop_reason, 'max_tokens'); // padrao-ok: teste com fetch simulado, o status é asserido no próprio cenário

// 6) ferramenta própria: não emula, devolve o Claude
assert.equal((await rodar({ claude: { status: 402 } }, { tools: [{ name: 'consultar', input_schema: {} }] })).status, 402);

// 7) reserva respeita o orçamento do chamador: com menos de 8 s sobrando, não chama o Gemini
assert.equal((await rodar({ claude: { status: 402 } }, {}, { timeoutMs: 5000 })).status, 402, 'sem tempo → erro original');
assert.ok(!chamadas.some((c) => c.ia === 'gemini'), 'orçamento curto não aciona reserva');

// 8) Gemini primário que falhou não é chamado de novo como reserva do Claude
cenario = { claude: { status: 402 }, gemini: 'fora' }; chamadas.length = 0;
await iaTexto({ prompt: 'oi' });
assert.equal(chamadas.filter((c) => c.ia === 'gemini').length, 1, 'Gemini uma vez só');

// 5) iaTexto nos dois sentidos
cenario = { claude: { status: 200, corpo: { content: [{ type: 'text', text: 'do claude' }] } }, gemini: 'fora' };
assert.deepEqual(await iaTexto({ prompt: 'oi' }).then((r) => [r.texto, r.provedor]), ['do claude', 'claude'], 'Gemini fora → Claude');
cenario = { claude: { status: 402 } };
assert.deepEqual(await iaTexto({ prompt: 'oi', primario: 'claude' }).then((r) => [r.texto, r.provedor]), ['{"ok":true}', 'gemini'], 'Claude fora → Gemini');
cenario = { claude: { status: 402 }, gemini: 'fora' };
assert.equal(await iaTexto({ prompt: 'oi' }), null, 'as duas fora → null (nunca texto vazio como resposta)');

console.log('ok — uma IA cai, a outra assume (nos dois sentidos)');
