/**
 * scripts/testes/clique-vira-preferencia-mas-nunca-filtra.mjs
 *
 * POR QUE EXISTE (10/09). O e-mail semanal passou a reordenar o bloco "sua região" pelo tipo
 * de imóvel que o cliente já clicou (pedido do dono: "aprimorar para enviar imóveis
 * semelhantes"). Dois jeitos de errar isso são silenciosos e só aparecem em produção:
 *   1. Empate virando preferência: `nTop/total >= 0.5` (em vez de `> 0.5`) elegeria um tipo
 *      arbitrário sempre que o cliente clicasse 1x em cada um de dois tipos — um sinal
 *      fabricado a partir de indiferença real. Pego e corrigido nesta mesma sessão, ANTES de
 *      ir a produção, escrevendo este teste.
 *   2. Reordenar virando filtrar: se `priorizarTipo` perder algum item no caminho, o e-mail
 *      encolhe sem motivo aparente — o mesmo formato do bug "instrumento mede uma coisa e
 *      reporta com o nome de outra" (HANDOFF, forma nº10).
 * As duas funções são IMPORTADAS do cron, nunca reproduzidas aqui.
 */
import { tipoPreferidoDeCliques, priorizarTipo } from '../../api/enviar-alertas-cron.js';

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\ntipoPreferidoDeCliques — mínimo de 2 cliques e maioria ESTRITA');
{
  ok(tipoPreferidoDeCliques({}) === null, 'sem cliques: nenhuma preferência');
  ok(tipoPreferidoDeCliques({ apartamento: 1 }) === null, '1 clique isolado: curiosidade, não preferência');
  ok(tipoPreferidoDeCliques({ apartamento: 2 }) === 'apartamento', '2 cliques no mesmo tipo: elege');
  ok(tipoPreferidoDeCliques({ apartamento: 2, casa: 1 }) === 'apartamento', '2 de 3 (66%): maioria clara elege');
  ok(tipoPreferidoDeCliques({ apartamento: 1, casa: 1 }) === null, 'empate 1-1 (50/50): NÃO elege ninguém');
  ok(tipoPreferidoDeCliques({ apartamento: 2, casa: 2 }) === null, 'empate 2-2 (50/50): NÃO elege ninguém');
  ok(tipoPreferidoDeCliques({ apartamento: 1, casa: 1, terreno: 1 }) === null, 'empate triplo: minoria (33%) não é maioria');
  ok(tipoPreferidoDeCliques({ apartamento: 3, casa: 1, terreno: 1 }) === 'apartamento', '3 de 5 (60%): maioria mesmo com 3 tipos no jogo');
}

console.log('\npriorizarTipo — reordena, JAMAIS filtra');
{
  const lista = [{ id: 'a', tipo: 'casa' }, { id: 'b', tipo: 'apartamento' }, { id: 'c', tipo: 'apartamento' }, { id: 'd', tipo: 'terreno' }];

  const semPreferencia = priorizarTipo(lista, null);
  ok(semPreferencia.length === 4 && semPreferencia === lista, 'sem tipoPreferido: devolve a MESMA lista, intacta');

  const comPreferencia = priorizarTipo(lista, 'apartamento');
  ok(comPreferencia.length === 4, 'com tipoPreferido: tamanho não muda — nunca filtra');
  ok(comPreferencia.every(im => lista.some(o => o.id === im.id)), 'nenhum item somado nem trocado, só reordenado');
  ok(comPreferencia[0].tipo === 'apartamento' && comPreferencia[1].tipo === 'apartamento', 'os dois apartamentos vêm primeiro');
  ok(comPreferencia[0].id === 'b' && comPreferencia[1].id === 'c', 'ordem relativa ENTRE os apartamentos é preservada (estável)');
  ok(comPreferencia[2].id === 'a' && comPreferencia[3].id === 'd', 'ordem relativa do resto também é preservada (estável)');

  const semNenhumMatch = priorizarTipo(lista, 'galpao');
  ok(semNenhumMatch.length === 4 && semNenhumMatch.map(i => i.id).join('') === 'abcd', 'tipoPreferido sem nenhum item correspondente: lista sai como entrou');

  ok(priorizarTipo([], 'apartamento').length === 0, 'lista vazia não quebra');
  ok(priorizarTipo(null, 'apartamento').length === 0, 'lista null não quebra (defesa de chamador)');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
