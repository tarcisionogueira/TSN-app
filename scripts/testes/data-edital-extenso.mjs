// Data do leilão divergente do edital (11/11, caso Cravo 12733, Feira de Santana — pedido do dono:
// "isso precisa ser corrigido e não pode se repetir"). O edital escrevia as praças por extenso e
// nenhum leitor do sistema entendia; o acervo ficou com 09/03/2027 contra 21/01 e 28/01/2027.
import { normalizarDatasPorExtenso } from '../../api/_data-br.js';
import { extrairCondicoes } from '../../api/_edital-extrato.js';
import { dataDoResumoSoleon } from '../lib/data-resumo-leilao.mjs';
import { extrairData } from '../lib/scraper-core.mjs';

let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

// 1. Normalização
eq('extenso simples', normalizarDatasPorExtenso('no dia 21 de janeiro de 2027, às 15h'), 'no dia 21/01/2027, às 15h');
eq('1º de março', normalizarDatasPorExtenso('1º de março de 2027'), '01/03/2027');
eq('março sem cedilha e maiúscula', normalizarDatasPorExtenso('5 de MARCO de 2027'), '05/03/2027');
eq('abreviado com ponto', normalizarDatasPorExtenso('28 de jan. de 2027'), '28/01/2027');
eq('dia por extenso entre parênteses', normalizarDatasPorExtenso('21 (vinte e um) de janeiro de 2027'), '21/01/2027');
eq('dd.mm.aaaa', normalizarDatasPorExtenso('em 21.01.2027'), 'em 21/01/2027');
eq('dd-mm-aaaa', normalizarDatasPorExtenso('em 21-01-2027'), 'em 21/01/2027');
eq('já numérica fica igual', normalizarDatasPorExtenso('21/01/2027'), '21/01/2027');
eq('processo CNJ não vira data', normalizarDatasPorExtenso('processo 0002291-54.1996.8.05.0080'), 'processo 0002291-54.1996.8.05.0080');
eq('mês inválido não muda', normalizarDatasPorExtenso('31.13.2027'), '31.13.2027');
eq('texto sem data não muda', normalizarDatasPorExtenso('Lote de terra nº 24'), 'Lote de terra nº 24');

// 2. O edital real da Cravo (trecho), lido pelo extrator de praças
const edital = 'O Leiloeiro Público Oficial VIRIATO DOMINGUES CRAVO, matrícula JUCEB n.º 15/055964-0, devidamente autorizado, '
  + 'levará a público leilão os bens abaixo descritos, na forma eletrônica, conforme segue: '
  + '1º Leilão no dia 21 de janeiro de 2027, com encerramento às 15:00h, onde os bens serão vendidos por valor igual ou superior ao da avaliação; '
  + '2º Leilão no dia 28 de janeiro de 2027, com encerramento às 15:00h, ocasião em que os bens serão vendidos pelo maior lance, '
  + 'desde que não seja vil, considerando-se vil o lance inferior a 50% (cinquenta por cento) do valor da avaliação. '
  + 'Avaliação: R$ 120.000,00. Pagamento à vista ou parcelado conforme art. 895 do CPC.';
const cond = extrairCondicoes(edital);
eq('edital por extenso: 1ª praça com data', cond?.pracas?.[0]?.data, '2027-01-21');
eq('edital por extenso: 2ª praça com data', cond?.pracas?.[1]?.data, '2027-01-28');

// 3. Resumo publicado pelo leiloeiro (plataforma SOLEON)
eq('resumo com hora', dataDoResumoSoleon('Leilão: 21/01/2027 às 15:00, LOTE 01: IMÓVEL'), '2027-01-21T15:00:00-03:00');
eq('resumo sem hora', dataDoResumoSoleon('Leilão: 21/01/2027, LOTE 01'), '2027-01-21');
eq('sem resumo', dataDoResumoSoleon('LOTE 01: IMÓVEL – Lote de terra'), null);
eq('data no meio do texto não conta', dataDoResumoSoleon('Imóvel. Leilão: 21/01/2027'), null);

// 4. Extrator genérico: data de DOCUMENTO não vira data de leilão (Cravo 12732: "expedida em 14/10/2027")
const paginaCravo = '<div>ÔNUS: Consta na matrícula do imóvel expedida em 14/10/2027: R-1: PENHORA. Débitos até 08/10/2026, apurados em 02/10/2026.</div>';
eq('expedida em não é data de leilão', extrairData(paginaCravo), null);
eq('ancorada em leilão continua valendo', extrairData('<p>Data do leilão: 21/01/2027 às 15:00</p>'), '2027-01-21');
eq('data futura solta sem contexto de documento ainda vale', extrairData('<p>Encerra 21/01/2099</p>'), '2099-01-21');

// 5. Edital com DUAS TENTATIVAS (o caso real): a 1ª tentativa é o calendário vigente
const duasTentativas = edital.replace('Avaliação:', 'SEGUNDA TENTATIVA: 1º Leilão no dia 02 de março de 2027, com encerramento às 15:00h; 2º Leilão no dia 09 de março de 2027, com encerramento às 15:00h. Avaliação:');
const c2 = extrairCondicoes(duasTentativas);
eq('duas tentativas: 1ª praça é a da 1ª tentativa', c2?.pracas?.[0]?.data, '2027-01-21');
eq('duas tentativas: 2ª praça é a da 1ª tentativa', c2?.pracas?.[1]?.data, '2027-01-28');

console.log(`data-edital-extenso: ${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
