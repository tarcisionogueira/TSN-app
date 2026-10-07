// VENCIMENTO DO BOLETO — 7 dias corridos (07/10, decisão do dono). O MP, sem `date_of_expiration`,
// aplica o padrão dele (3 dias), curto demais para a parcela "para dar entrada no registro".
// O que o teste trava: o formato que o MP aceita (ISO com offset explícito) e a contagem feita no
// fuso de Brasília — usar a data UTC daria um dia a mais ao cliente entre 21h e 0h BRT.
import assert from 'node:assert/strict';
// Importa a função DO HANDLER (api/_boleto-vencimento.js). Um teste que copia a função mede a
// cópia no dia em que uma das duas mudar — foi para isso que o módulo saiu do mp-checkout.
import { DIAS_BOLETO, vencimentoBoleto } from '../../api/_boleto-vencimento.js';

assert.equal(DIAS_BOLETO, 7, 'o prazo combinado com o dono é 7 dias corridos');

const FORMATO = /^\d{4}-\d{2}-\d{2}T23:59:59\.000-03:00$/;

// meio-dia de 07/10/2026 em Brasília = 15:00 UTC → vence 14/10
assert.equal(vencimentoBoleto(7, Date.parse('2026-10-07T15:00:00Z')), '2026-10-14T23:59:59.000-03:00');
// 22h de 07/10 em Brasília = 01:00 UTC de 08/10 — ainda é dia 7 aqui, então vence 14, não 15.
assert.equal(vencimentoBoleto(7, Date.parse('2026-10-08T01:00:00Z')), '2026-10-14T23:59:59.000-03:00');
// vira o mês e vira o ano sem gambiarra de aritmética de data
assert.equal(vencimentoBoleto(7, Date.parse('2026-10-28T15:00:00Z')), '2026-11-04T23:59:59.000-03:00');
assert.equal(vencimentoBoleto(7, Date.parse('2026-12-28T15:00:00Z')), '2027-01-04T23:59:59.000-03:00');
// formato aceito pelo MP em qualquer data sorteada
for (let i = 0; i < 400; i++) {
  const t = Date.parse('2026-01-01T00:00:00Z') + Math.floor(Math.random() * 365 * 86400000);
  assert.match(vencimentoBoleto(7, t), FORMATO);
  // e o vencimento é sempre no futuro (7 dias à frente, nunca hoje)
  assert.ok(Date.parse(vencimentoBoleto(7, t)) > t, 'vencimento precisa ser futuro');
}
console.log('boleto-vencimento: todos os casos passaram');
