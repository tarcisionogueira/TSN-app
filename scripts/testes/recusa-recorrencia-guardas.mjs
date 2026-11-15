// Bug bounty 07/11, achado 3: recusa de cobrança recorrente não rebaixa quem está acima do plano recusado nem o anual pago.
import assert from 'node:assert/strict';
// O módulo cria o cliente do Supabase na importação: URL/chave fictícias (nenhuma chamada de rede acontece neste teste).
process.env.VITE_SUPABASE_URL ||= 'http://localhost:54321'; process.env.SUPABASE_SERVICE_KEY ||= 'teste';
const { guardaRebaixeRecorrencia } = await import('../../api/_webhook-core.js');
const agora = Date.parse('2026-11-15T12:00:00Z');
assert.equal(guardaRebaixeRecorrencia({ role: 'assessorado' }, 'top2', agora), 'papel_acima_do_plano', 'assessoria contratada, Pro antigo recusado');
assert.equal(guardaRebaixeRecorrencia({ role: 'top2', plano_ciclo: 'anual', plano_vencimento: '2027-03-01' }, 'top2', agora), 'anual_vigente');
assert.equal(guardaRebaixeRecorrencia({ role: 'top2', plano_ciclo: 'anual', plano_vencimento: '2026-10-01' }, 'top2', agora), null, 'anual vencido rebaixa');
assert.equal(guardaRebaixeRecorrencia({ role: 'top2', plano_ciclo: 'mensal' }, 'top2', agora), null, 'mensal recusado rebaixa (regra do dono)');
assert.equal(guardaRebaixeRecorrencia({ role: 'top2' }, null, agora), null, 'sem plano de referência: segue a regra antiga');
console.log('recusa-recorrencia-guardas: ok');
