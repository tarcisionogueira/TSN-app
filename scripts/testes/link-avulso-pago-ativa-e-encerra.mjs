// 08/11 (dono): o William pagou R$ 8.000 no link feito para ele, continuou explorador e o link do Asaas seguiu pagável.
import assert from 'node:assert/strict';
import { efeitoDoProduto } from '../../src/lib/cobranca-produto.js';
import { aplicarEfeitosDaCobranca, gatewayDoPagamento } from '../../api/_cobranca-avulsa-efeitos.js';

for (const k of ['assessorado', 'assessorado_vista', 'assessorado_negociada']) assert.deepEqual(efeitoDoProduto(k), { tipo: 'assessoria' });
assert.deepEqual(efeitoDoProduto('top2_anual'), { tipo: 'plano', planoKey: 'top2_anual' });
for (const k of ['registro_imovel', '', null]) assert.equal(efeitoDoProduto(k), null);
assert.equal(gatewayDoPagamento('pay_123'), 'asaas');
assert.equal(gatewayDoPagamento('187379238351'), 'mercadopago');

const montar = (extra = {}) => {
  const log = { confirmados: [], marcados: [], chamadas: [] };
  const d = {
    asaasUrl: 'https://asaas', asaasKey: 'x', mpToken: 'y', mpPendentes: [], valorLiquido: 6225.21,
    processarConfirmado: async (a) => { log.confirmados.push(a); return { ok: true }; },
    ativarPlanoDireto: async (a) => { log.confirmados.push(a); return { ok: true }; },
    buscarCliente: async () => ({ id: 'u1' }),
    marcarAtivado: async (id) => { log.marcados.push(id); },
    fetch: async (url, op = {}) => {
      log.chamadas.push(`${op.method || 'GET'} ${url}`);
      if (url.includes('status=PENDING')) return { ok: true, json: async () => ({ data: [{ id: 'pay_link' }] }) };
      if (url.includes('status=OVERDUE')) return { ok: true, json: async () => ({ data: [] }) };
      return { ok: true, json: async () => ({}) };
    },
    ...extra,
  };
  return { d, log };
};
const william = { id: 'c1', valor: '8000.00', descricao: 'Assessoria', destinatario_email: 'a@b.c', gateway_payment_id: '187379238351', produto_key: 'assessorado_negociada' };

// Pagou no MP: ativa pelo destinatário, sem o id do pagador, e cancela o Asaas.
let { d, log } = montar();
let r = await aplicarEfeitosDaCobranca(william, d);
assert.equal(r.ativou, true);
assert.equal(log.confirmados[0].planoForcado, 'assessorado');
assert.equal(log.confirmados[0].email, 'a@b.c');
assert.equal(log.confirmados[0].gatewayCustomerId, null);
assert.equal(log.confirmados[0].valorLiquido, 6225.21);
assert.deepEqual(log.marcados, ['c1']);
assert.deepEqual(r.asaas_canceladas, ['pay_link']);
assert.ok(log.chamadas.includes('DELETE https://asaas/payments/pay_link'));

// Repetição: já ativou, não ativa de novo e não comissiona duas vezes.
({ d, log } = montar());
await aplicarEfeitosDaCobranca({ ...william, produto_ativado_em: '2026-11-08' }, d);
assert.equal(log.confirmados.length, 0);

// Sem conta: não finge que ativou nem encerra; o erro volta para o cron e para o alerta.
({ d, log } = montar({ processarConfirmado: async () => ({ skipped: 'perfil_nao_encontrado' }) }));
await assert.rejects(aplicarEfeitosDaCobranca(william, d), /conta de a@b\.c não encontrada/);
assert.equal(log.marcados.length, 0);

// Sem produto de plano: só encerra as pendências.
({ d, log } = montar());
r = await aplicarEfeitosDaCobranca({ ...william, produto_key: 'registro_imovel' }, d);
assert.equal(r.ativou, false);
assert.equal(log.confirmados.length, 0);
assert.deepEqual(r.asaas_canceladas, ['pay_link']);

// Não cancela o próprio pagamento que quitou, em nenhum gateway.
({ d, log } = montar());
await aplicarEfeitosDaCobranca({ ...william, produto_key: null, gateway_payment_id: 'pay_link' }, d);
assert.ok(!log.chamadas.some((c) => c.startsWith('DELETE')));
({ d, log } = montar({ mpPendentes: ['187379238351', '999'] }));
r = await aplicarEfeitosDaCobranca({ ...william, produto_key: null }, d);
assert.deepEqual(r.mp_canceladas, ['999']);

// "Não consegui ler o Asaas" não vira "não há pendência".
({ d, log } = montar({ fetch: async () => ({ ok: false, status: 500 }) }));
await assert.rejects(aplicarEfeitosDaCobranca({ ...william, produto_key: null }, d), /Asaas: leitura de PENDING HTTP 500/);

// Pix expirado do MP não aceita cancelar: registra e segue.
({ d, log } = montar({ mpPendentes: ['999'] }));
const fetchBase = d.fetch;
d.fetch = async (url, op) => (url.includes('mercadopago') ? { ok: false, status: 400 } : fetchBase(url, op));
r = await aplicarEfeitosDaCobranca({ ...william, produto_key: null }, d);
assert.deepEqual(r.mp_recusadas, ['999: HTTP 400']);
console.log('ok: link avulso pago ativa o produto e encerra as pendências');
