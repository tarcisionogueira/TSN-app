// Opção 3 do dono (30/09) — Embu-Guaçu na APRM: comparáveis de DENTRO da restrição decidem o valor;
// com menos de 3, o valor fica com ALERTA. Sem restrição, nada muda.
import assert from 'node:assert/strict';
import { aplicarRestricaoNasAmostras } from '../../api/_restricao-amostras.js';

const v = (m2, dentro) => ({ valor: m2 * 1000, m2: 1000, valorM2: m2, ...(dentro === undefined ? {} : { dentroRestricao: dentro }) });
const base = () => ({
  nivel1: { vendas: [v(40, true), v(450, false), v(30, true)] },
  nivel2: { vendas: [v(35, true), v(500)] },
  consolidado: { valorEstimadoImovel: 582000, areaConsiderada: 2503, precoMedioM2: 232 },
  comentario: 'Mercado aquecido.',
});
const R = 'APRM Guarapiranga (manancial), SUC';

// 3 de dentro → só elas; mediana 35 × 2503
const m = aplicarRestricaoNasAmostras(base(), { restricoes: R, areaM2: 2503 });
assert.equal(m.consolidado.valorEstimadoImovel, 35 * 2503);
assert.equal(m.nivel1.vendas.length, 2); assert.equal(m.nivel2.vendas.length, 1);
assert.equal(m.restricaoAmostras.aplicada, true); assert.equal(m.restricaoAmostras.dentro, 3);
assert.match(m.consolidado.baseCalculo, /DENTRO da mesma restrição/);

// 2 de dentro → valor mantido + alerta no comentário
const b2 = base(); b2.nivel2.vendas[0].dentroRestricao = false;
const m2 = aplicarRestricaoNasAmostras(b2, { restricoes: R, areaM2: 2503 });
assert.equal(m2.consolidado.valorEstimadoImovel, 582000, 'opção 1: mantém o valor');
assert.equal(m2.restricaoAmostras.aplicada, false);
assert.match(m2.comentario, /^ATENÇÃO — restrição territorial.*só 2 anúncio/);
assert.equal(m2.nivel1.vendas.length, 3, 'não apaga amostra quando não aplica');

// 3 de dentro mas área desconhecida → não aplica, alerta (nunca usa areaConsiderada da IA, que pode ser hectare)
const m5 = aplicarRestricaoNasAmostras(base(), { restricoes: R, areaM2: 0 });
assert.equal(m5.restricaoAmostras.aplicada, false); assert.equal(m5.consolidado.valorEstimadoImovel, 582000);
assert.match(m5.comentario, /área do imóvel não é conhecida/);

// sem restrição → intocado
const b3 = base(); const antes = JSON.stringify(b3);
assert.equal(JSON.stringify(aplicarRestricaoNasAmostras(b3, { restricoes: '' })), antes);

// "não sei" (sem o campo) não conta como dentro
const b4 = { nivel1: { vendas: [v(40), v(30), v(35)] }, consolidado: { valorEstimadoImovel: 1 } };
assert.equal(aplicarRestricaoNasAmostras(b4, { restricoes: R }).restricaoAmostras.aplicada, false);
console.log('ok — comparáveis dentro da restrição');
