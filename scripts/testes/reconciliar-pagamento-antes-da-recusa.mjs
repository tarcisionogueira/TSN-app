// Bug bounty 07/11, achado 5: pagamento do mês anterior não reativa quem teve a renovação recusada depois.
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL ||= 'http://localhost:54321'; process.env.SUPABASE_SERVICE_KEY ||= 'teste';
const { dataPagamentoAnteriorARecusa: antes } = await import('../../api/reconciliar-asaas-cron.js');
assert.equal(antes({ confirmedDate: '2026-10-15' }, '2026-11-15T10:00:00Z'), true, 'pago em outubro, recusado em novembro → não reativa');
assert.equal(antes({ confirmedDate: '2026-11-16' }, '2026-11-15T10:00:00Z'), false, 'pagou depois da recusa → reativa');
assert.equal(antes({ paymentDate: '2026-11-15' }, '2026-11-15T22:00:00Z'), false, 'mesmo dia conta como regularização');
assert.equal(antes({ confirmedDate: '2026-10-15' }, null), false, 'sem recusa registrada → fluxo normal (órfão do webhook)');
assert.equal(antes({}, '2026-11-15T10:00:00Z'), true, 'sem data do pagamento → não prova que é novo');
console.log('reconciliar-pagamento-antes-da-recusa: ok');
