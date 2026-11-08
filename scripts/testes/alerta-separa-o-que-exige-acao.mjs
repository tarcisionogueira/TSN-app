// 08/11: o aviso de Carpina existia e se perdeu. Pesquisa fraca precisa ser reconhecida, e o e-mail separa o urgente.
import assert from 'node:assert/strict';
import { motivoBuscaFraca } from '../../api/_auditoria-relatorio.js';
import { blocosDoAlerta, aplicarExplicacoes } from '../../api/health-check.js';

const comPreco = { valor: 200000, m2: 70 };
const semPreco = { valor: 0, m2: 70 };
const res = (vendas, extra = {}) => ({ mercadoVazio: false, mercado: { nivel2: { vendas }, ...extra } });

assert.equal(motivoBuscaFraca(res([semPreco, { valor: 257500, m2: 0 }])), 'sem_comparavel_com_preco');
assert.equal(motivoBuscaFraca(res([])), 'sem_comparavel_com_preco');
assert.equal(motivoBuscaFraca(res([comPreco], { comentarioCitouLeilao: true })), 'ia_apontou_leilao');
assert.equal(motivoBuscaFraca(res([comPreco])), null);
// Mercado vazio tem autoconserto próprio; vaga e área rural são precificadas por unidade.
assert.equal(motivoBuscaFraca({ mercadoVazio: true, mercado: { nivel2: { vendas: [] } } }), null);
assert.equal(motivoBuscaFraca(res([{ valor: 50000, m2: 0 }]), { porUnidade: true }), null);

const itens = () => [
  { nome: 'Pagamentos', status: 'erro', detalhe: 'pagou, falta ativar' },
  { nome: 'IBGE', status: 'erro', detalhe: 'fetch failed' },
  { nome: 'Landing', status: 'aviso', detalhe: 'cache velho' },
  { nome: 'Banco', status: 'ok', detalhe: 'ok' },
];
const b = blocosDoAlerta(itens());
assert.equal(b.agir, 2); assert.equal(b.saber, 1);
assert.ok(b.html.indexOf('Agir hoje') < b.html.indexOf('Para saber'));
assert.ok(!b.html.includes('Banco'));

// Com explicação, sai de "agir hoje" e continua mostrando o estado real.
const explicados = aplicarExplicacoes(itens(), [{ nome: 'IBGE', explicacao: 'dado anual já carregado.', explicado_ate: '2026-12-08T12:00:00Z' }]);
const ibge = explicados.find((i) => i.nome === 'IBGE');
assert.equal(ibge.status, 'aviso');
assert.match(ibge.detalhe, /Ciente até 08\/12\/2026.*fetch failed/);
assert.equal(explicados.find((i) => i.nome === 'Pagamentos').status, 'erro');
assert.equal(blocosDoAlerta(explicados).agir, 1);
// Item verde não ganha texto de explicação.
const verde = aplicarExplicacoes(itens(), [{ nome: 'Banco', explicacao: 'x', explicado_ate: '2026-12-08T12:00:00Z' }]);
assert.equal(verde.find((i) => i.nome === 'Banco').detalhe, 'ok');
console.log('ok: pesquisa fraca reconhecida e alerta separado');
