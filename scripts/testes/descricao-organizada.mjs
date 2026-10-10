// Teste do organizador da descrição do leiloeiro (src/utils/descricaoOrganizada.js) sobre texto REAL.
import assert from 'node:assert/strict';
import { organizarDescricao } from '../../src/utils/descricaoOrganizada.js';

const fiorino = 'FIAT FIORINO HD WK E, 2018/2018, Placa FINAL 4 (SP), CH.: Fiat Fiorino Marca: FIAT Modelo: FIORINO HD WK E Ano Fab/Modelo: 2018/2018 Placa FINAL 4 (SP) Quilometragem acima de: 297100 Cor: BRANCA Combustível: ALCOOL/GASOLINA Chassi: Acessórios Nº de Portas: 2 Ar condicionado: Não Condições Gerais Motor: Funcionando Observações: VEICULO SUJO PODENDO ESCONDER AVARIAS/ VEICULO FUNCIONANDO/ PNEUS REGULARES/ VEICULO NÃO POSSUI AR CONDICIONADO/ CHAVE RESERVA AUSENTE/ TRIANGULO AUSENTE, DEMAIS ITENS DE SEGURANÇA PRESENTE/ Acessórios: - RODAS DE LIGA LEVE : Não - FARÓIS DE MILHA / NEBLINA : Não - LIMPADOR VIDRO TRASEIRO : Não - DESEMBAÇADOR VIDRO TRASEIRO : Não - TRAVA ELÉTRICA : Não - VIDROS ELÉTRICOS : Não - ESPELHO ELÉTRICO : Não - TETO SOLAR : Não - BANCO DE COURO : Não - RÁDIO / MULTIMÍDIA : Não - PILOTO AUTOMÁTICO : Não - CÂMBIO AUTOMÁTICO : Não - AR CONDICIONADO : Não - DIREÇÃO HIDRÁULICA / ELÉTRICA : Sim - AIR-BAG : Sim - ABS : Sim Será de responsabilidade do comprador o pagamento dos débitos de eventuais multas de trânsito, licenciamento, DPVAT (seguro obrigatório) e IPVA relativos ao(s) veículo(s) vendido(s) ainda que anteriores à data do evento. Débitos em aberto: Nada consta Sujeito a alterações de acordo com os cadastros dos órgãos públicos até a data da transferência do veículo Além das comissões, o comprador deverá pagar encargos de administração, conforme estipulado nas Condições de Venda e Pagamento, previamente aceitas para participar do evento 202602636 Cremer — FIAT FIORINO HD WK E, 2018/2018, Placa FINAL 4 (SP),';

const b = organizarDescricao(fiorino);
console.log(JSON.stringify(b, null, 2));
const tipo = (t) => b.find((x) => x.tipo === t);
const campo = (r) => tipo('campos').itens.find(([k]) => k.toLowerCase() === r.toLowerCase())?.[1];
assert.equal(campo('Marca'), 'FIAT');
assert.equal(campo('Cor'), 'BRANCA');
assert.equal(campo('Motor'), 'Funcionando');
assert.equal(campo('Débitos em aberto'), 'Nada consta');
assert.equal(campo('Chassi'), undefined, 'Chassi vazio não vira campo');
assert.ok(tipo('checklist').tem.includes('Air-bag') && tipo('checklist').tem.length === 3);
assert.equal(tipo('checklist').naoTem.length, 13);
assert.ok(tipo('lista').itens.length >= 5);
const texto = tipo('paragrafos').itens.join(' ');
assert.ok(/Será de responsabilidade/.test(texto) && /Além das comissões/.test(texto));
assert.ok(!/202602636 Cremer/.test(JSON.stringify(b)), 'resumo repetido do fim sai');

// Texto livre (imóvel sem ficha) → só parágrafos, nada perdido.
const livre = 'Apartamento com 2 quartos, sala e cozinha. Imóvel ocupado. Débitos de IPTU por conta do arrematante.';
const bl = organizarDescricao(livre);
assert.equal(bl.length, 1); assert.equal(bl[0].tipo, 'paragrafos');
assert.equal(bl[0].itens.join(' '), livre);
console.log('✓ descricao-organizada: ok');

// Já estruturado em linhas (FB): respeita as linhas.
const fb = 'CAMINHONETE TRACKER LTZ AT, marca CHEVROLET.\n Alienação Fiduciária em favor de BANCO DO BRASIL S.A .  Constam Débitos no Detran.\n RENAJUD  CIRCULAÇÃO:0000457-08.2020.5.12.0055\n Obs1: O veículo será arrematado livre de qualquer ônus.';
const bf = organizarDescricao(fb);
assert.equal(bf[0].tipo, 'linhas'); assert.equal(bf[0].itens.length, 4);
// Lixo RSC da NORDESTE some; a ficha (Avaliação/Lance mínimo/Localização) aparece.
const nord = '([1,"\\u003cp\\u003eBens: 01 (UM) AUTOMÓVEL CHEVROLET/S10, COR PRETA. Localização do Bem: RUA JOVELINA SAMPAIO, Nº 42, PIRITIBA/BA. Avaliação: R$ 102.987,00 – Lance Mínimo: R$ 41.194,80\\u003c/p\\u003e"]) ';
const bn = organizarDescricao(nord);
assert.ok(!/u003c|\(\[1/.test(JSON.stringify(bn)), 'sem lixo de HTML/RSC');
assert.ok(bn.find((x) => x.tipo === 'campos').itens.some(([k, v]) => k === 'Lance Mínimo' && v.includes('41.194,80')));
// Ficha com " / " (SUPORTE): valor sem a barra no fim.
const sup = organizarDescricao('Marca: VW / Modelo: NOVO FOX TRACK ME / Placa: QHB8949 / Cor: BRANCA / OBSERVAÇÃO: ALTERAÇÃO NO DOC.');
assert.equal(sup.find((x) => x.tipo === 'campos').itens.find(([k]) => k === 'Marca')[1], 'VW');
console.log('✓ descricao-organizada: casos extras ok');
