// Lote manual (05/10): matrícula escaneada com carimbo e edital do Bradesco com vários imóveis —
// trechos REAIS do Alphaville Burle Marx (Lote 06, Qd. 10).
import assert from 'node:assert/strict';
import { textoUtil, ehTextoSoCarimbo, ehEditalMultiLote, trechoDoLote } from '../../src/utils/loteNoEdital.js';

const carimbo = 'Valide este documento clicando no link a seguir: https://assinador-web.onr.org.br/docs/TEKE3-J397R-49HV6-XS5ZCValide aqui\neste documento\n';
assert.equal(ehTextoSoCarimbo(carimbo.repeat(3)), true, 'só carimbo = escaneado');
assert.equal(textoUtil(carimbo.repeat(3)), '');
assert.equal(ehTextoSoCarimbo(carimbo + 'R-1/212.179 — Prot. 18.760. COMPRA E VENDA. '.repeat(15)), false, 'carimbo + texto real = texto');

const lote = (n, desc, lance) => `${n} ${desc}\nLance Mínimo: R$ ${lance}\n`;
const edital = '1\nEdital de Leilões\nLEILÃO SOMENTE ELETRÔNICO (on-line)\n09 de outubro de 2026, às 15:00 horas\nCondições de Venda\n'
  + 'x '.repeat(4000)
  + lote('3 26401 SP São Paulo-SP.', 'Bairro Tatuapé. Rua Tuiuti, nº 1.000, Apto 52. Área privativa 80,00m². Matrícula 8.777 do 2º RI local. Ocupada. (AF).', '766.000,00')
  + lote('4 26468 PR Dois Vizinhos-PR.', 'Bairro Vitória. Rua Maria Quitéria, nº 196, Casa 02, no Condomínio Residencial Fortunato 1. Área construída 50,81. Ocupada. (AF).', '90.000,00')
  + lote('5 25764 MG Juiz de Fora-MG.', 'Bairro Torreões (Zona Rural). Gleba B, na Fazenda Boa Esperança, com a área de 22,757ha. Ocupada. (AF).', '190.000,00')
  + lote('6 26673 SP Santana de Parnaíba-SP.', 'Alphaville. Alameda Picasso, nº 978 (Lt. 06, Qd. 10), Loteamento Alphaville Santanna\n(Burle Marx). Casa. Áreas totais: terreno 440,18m² e construção 246,66m², sendo 12,50m² de piscina. Inscrição\nmunicipal 24362.12.77.0080.00.000. Matrícula nº 17.876 do RI local. Obs.: Regularização dos débitos de IPTU e\nCondomínio, no valor aproximado de R$ 20.000,00 [...] serão de inteira responsabilidade do comprador. Ocupado. (AF).', '2.121.000,00')
  + lote('7 26672 SP São José do Rio Preto-SP.', 'Bairro Quinta do Lago Residence. Rua Nemézio Rodrigues Chaves, nº 181, Lote 15 da Quadra 01. Casa. Áreas totais: terreno 357,00m², construção 199,38m².', '1.050.000,00');
assert.equal(ehEditalMultiLote(edital), true);
assert.equal(ehEditalMultiLote('Edital. Lance mínimo: R$ 100.000,00'), false);

// Alvo = o que a IA leu da matrícula escaneada (endereço por extenso, sem número da casa).
const alvo = {
  nome: 'Lote 06 Quadra 10 - Alphaville Santanna',
  endereco: 'Lote de terreno urbano nº 06 da quadra 10 (parte residencial) do loteamento Alphaville Santanna, comercializado como Alphaville Burle Marx, situado na Avenida Picasso, cidade de Santana de Parnaíba',
  areaM2: 440.18, areaTerrenoM2: 440.18,
};
const t = trechoDoLote(edital, alvo);
assert.ok(t && t.includes('Lance Mínimo: R$ 2.121.000,00'), 'acha o lance DO lote 6');
assert.ok(t.indexOf('Alameda Picasso') < t.indexOf('2.121.000,00'), 'a descrição vem antes do lance');
assert.ok(!t.includes('1.050.000,00') && !t.includes('190.000,00'), 'sem o lance de outro lote');
// Edital de praças (1º/2º leilão): as duas linhas entram.
const pracas = 'Condições gerais. '.repeat(50) + 'Lote 1: Casa na Rua Itapeva, Jardim Paulista, terreno 300,00m².\n1º Leilão: R$ 900.000,00\n2º Leilão: R$ 450.000,00\nLote 2: Apto na Rua Augusta, 70,00m².\n1º Leilão: R$ 500.000,00';
const tp = trechoDoLote(pracas, { endereco: 'Casa na Rua Itapeva, Jardim Paulista', areaTerrenoM2: 300 });
assert.ok(tp.includes('450.000,00') && !tp.includes('500.000,00'), 'praças do lote, sem o lote seguinte');
// Alvo que não está no edital: nada (melhor não extrair que extrair o lote errado).
assert.equal(trechoDoLote(edital, { endereco: 'Rua das Acácias, Condomínio Jardim Botânico, Brasília' }), null);
assert.equal(trechoDoLote(edital, {}), null);
console.log('ok lote-no-edital');

// Escolha do parcelamento — as 3 opções REAIS do edital Bradesco (seção 7), lance R$ 2.121.000.
import { escolherParcelamento } from '../../src/utils/loteNoEdital.js';
const opcoes = [
  { entradaPct: 25, parcelas: 12, jurosAnualPct: 0, tabela: null, valorMin: null, valorMax: null },
  { entradaPct: 25, parcelas: 24, jurosAnualPct: 12, tabela: 'price', valorMin: null, valorMax: 100000 },
  { entradaPct: 30, parcelas: 48, jurosAnualPct: 12, tabela: 'price', valorMin: 100000, valorMax: null },
];
const e = escolherParcelamento(opcoes, 2121000);
assert.deepEqual([e.entradaPct, e.parcelas, e.jurosAnualPct], [25, 12, 0], 'sem juros vence');
const semZero = escolherParcelamento(opcoes.slice(1), 2121000);
assert.deepEqual([semZero.entradaPct, semZero.parcelas], [30, 48], 'faixa de valor respeitada (a de até 100 mil sai)');
assert.equal(escolherParcelamento(opcoes.slice(1, 2), 2121000), null, 'nenhuma vale para o lance');
assert.equal(escolherParcelamento([], 1), null);
console.log('ok escolher-parcelamento');
