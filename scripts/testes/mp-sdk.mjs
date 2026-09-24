/** npm run testar:mp-sdk — porta única do SDK do Mercado Pago (api/_mp-sdk.js), sem rede. */
// Testa o wrapper sem rede: intercepta fetch e confere URL, corpo, headers e isolamento entre chamadas.
process.env.MP_ACCESS_TOKEN = 'TESTE';
const chamadas = [];
globalThis.fetch = async (url, init) => { chamadas.push({ url, init }); 
  if (String(url).includes('/v1/payments/999')) return new Response(JSON.stringify({ message: 'Payment not found', status: 404, cause: [] }), { status: 404 });
  return new Response(JSON.stringify({ id: 123, status: 'approved' }), { status: 201, headers: { 'content-type': 'application/json' } }); };
const { mpSdk } = await import('../../api/_mp-sdk.js');
let falhas = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };
const r1 = await mpSdk.criarPagamento({ transaction_amount: 10, external_reference: 'x' }, { idempotencyKey: 'chave-A', deviceId: 'dev-A' });
const h1 = chamadas[0].init.headers;
ok(chamadas[0].url === 'https://api.mercadopago.com/v1/payments', 'POST /v1/payments');
ok(JSON.parse(chamadas[0].init.body).external_reference === 'x', 'corpo sem transformação');
ok(h1['X-Idempotency-Key'] === 'chave-A' || h1['x-idempotency-key'] === 'chave-A', 'chave de idempotência nossa');
ok(Object.entries(h1).some(([k, v]) => /meli-session-id/i.test(k) && v === 'dev-A'), 'device ID no cabeçalho');
ok(Object.keys(h1).some(k => /product-id/i.test(k)), 'cabeçalho de produto do SDK (o que o MP mede)');
ok(r1.id === 123 && r1.api_response === undefined, 'resposta limpa');
await mpSdk.criarPreferencia({ items: [] }, { idempotencyKey: 'chave-B' });
const h2 = chamadas[1].init.headers;
ok(!Object.keys(h2).some(k => /meli-session-id/i.test(k)), 'device ID do cliente A NÃO vaza para a chamada seguinte');
ok((h2['X-Idempotency-Key'] || h2['x-idempotency-key']) === 'chave-B', 'chave da 2ª chamada é a dela');
try { await mpSdk.obterPagamento(999); ok(false, 'erro 404 deveria lançar'); } catch (e) { ok(e.message === 'Payment not found' && e.status === 404, 'erro no mesmo formato de antes (mensagem + status)'); }
console.log(falhas ? `✗ ${falhas} falha(s)` : '✓ todos'); process.exit(falhas ? 1 : 0);
