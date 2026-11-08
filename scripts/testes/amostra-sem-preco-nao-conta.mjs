// Caso real 4b9f76ef (Carpina, 08/11): a IA achou 5 vendas e devolveu 4 com valor 0. Elas bateram o alvo de 4,
// a 2ª busca não rodou e a tela mostrou "R$ 0,00" como comparável.
import assert from 'node:assert/strict';
import { vendaComPreco, vendasDe, limparAmostrasSemPreco } from '../../src/lib/niveis-mercado.js';
import { avaliarMercado } from '../../api/_valor-mercado.js';

const semPreco = (m2) => ({ fonte: 'ZAP Imóveis', valor: 0, valorM2: 0, m2, descricao: 'Casa à venda' });
const remax = { fonte: 'RE/MAX Brasil', valor: 257500, valorM2: 0, m2: 0, descricao: 'Casa com 3 Dormitórios' };
const mercado = () => ({
  nivel1: { vendas: [], locacoes: [] },
  nivel2: {
    vendas: [semPreco(70), semPreco(100), semPreco(70), semPreco(110), remax],
    locacoes: [{ fonte: 'MGF Imóveis', valorMensal: 0, m2: 0 }],
    totalAmostras: 6,
  },
});

// Nenhuma das 5 precifica: a 2ª busca precisa rodar.
assert.equal(vendasDe(mercado()).filter(vendaComPreco).length, 0);
assert.equal(vendaComPreco({ valor: 257500, m2: 70 }), true);
assert.equal(vendaComPreco({ valorM2: 3000 }), true);

// A conta também não usa nenhuma.
const conta = avaliarMercado({ nivel1: [], nivel2: mercado().nivel2.vendas, nivel3: [], lote: { cidade: 'Carpina' } });
assert.equal(conta.consolidado.n, 0);

// Na tela, R$ 0,00 sai; preço sem metragem fica, porque vaga e área rural vão por unidade.
const m = mercado();
assert.equal(limparAmostrasSemPreco(m), 5);
assert.deepEqual(m.nivel2.vendas, [remax]);
assert.deepEqual(m.nivel2.locacoes, []);
assert.equal(m.nivel2.totalAmostras, 1);

// Nível que já está certo não muda.
const certo = { nivel1: { vendas: [{ valor: 200000, m2: 70 }], locacoes: [{ valorMensal: 1200 }], totalAmostras: 7 } };
assert.equal(limparAmostrasSemPreco(certo), 0);
assert.equal(certo.nivel1.totalAmostras, 7);
console.log('ok: amostra sem preço não conta e não aparece');
