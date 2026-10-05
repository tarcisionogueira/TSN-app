// Classificador de pátio (05/10, opção 2 do dono). Trechos REAIS do acervo de veículos.
import assert from 'node:assert/strict';
import { classificarPatio, patioPreservado } from '../lib/patio-veiculo.mjs';

const st = (t) => classificarPatio(t).status;
// confirmado — prova de pátio
assert.equal(st('Depósito: Patio da Leiloeira. Despesas de Remoção e Patio ficarão a cargo do Arrematante.'), 'confirmado');   // FB
assert.equal(st('Bem encontra-se: Rod. Anhanguera, Km 306,5 - Ribeirão Preto/SP - O comprador deverá pagar'), 'confirmado');  // Sodré
assert.equal(st('OBS: Veículo removido para Pátio.'), 'confirmado');                                                            // Mazzolli
// excluido — com o devedor (o "com o executado" não era pego até 05/10)
assert.equal(st('bem encontra-se com o executado no endereço: Rua Padre Biagio Simonetti, 427, Fraiburgo/SC'), 'excluido');   // Superbid
assert.equal(st('veículo não localizado, sujeito a busca e apreensão'), 'excluido');
// nao_confirmado — local informado, sem sinal de devedor → aparece com selo
assert.equal(st('Local para vistoria: rua Ludovico Solagna, quadra n.º 405, bairro São Miguel, em Fraiburgo (SC).'), 'nao_confirmado'); // Damiani
assert.equal(st('Localização do Bem: RUA E, CJ URBIS, Nº 28, BNH VELHO, XIQUE-XIQUE/BA.'), 'nao_confirmado');                   // Nordeste
assert.equal(st('Depositário: SICOOB Credisserrana. Vistoria: Rua Francisco de Paula Ramos, nº 66, Lages – SC.'), 'nao_confirmado'); // DBS
assert.equal(st('bem encontra-se com o representante da parte exequente, Sr. Cassiano'), 'nao_confirmado');                       // Superbid
// indefinido — "em mãos de" uma pessoa (pode ser o devedor) e texto sem sinal nenhum
assert.equal(st('Depósito: Em mãos de Nathael Luiz Schell, Rua Rio Fortuna, nº 116, Itajaí/SC.'), 'indefinido');                  // FB
assert.equal(st('Depósito: Veículo em mãos de SUELLEN CO STA, Contato: (049) 99121-351x'), 'indefinido');                        // FB
assert.equal(st('01 (um) veículo I/VW TIGUAN 2.0 TSI (Importado), ano/modelo 2013/2014'), 'indefinido');
// 'confirmado' já provado não é rebaixado por uma leitura fraca; herança de leilão é recalculada
assert.equal(patioPreservado({ status_patio: 'nao_confirmado' }, { status_patio: 'confirmado', status_patio_motivo: 'sinal textual' }), true);
assert.equal(patioPreservado({ status_patio: 'indefinido' }, { status_patio: 'confirmado', status_patio_motivo: 'leilão de pátio: 3 lote(s)' }), false);
console.log('patio-veiculo: todos os casos passaram');
