// #277 (24/10): a trava de proporção do sweep de "sumidos" (scraper-puppeteer.mjs → salvarEFinalizar).
// Números REAIS medidos no banco em 24/10 (imoveis_leilao + fonte_saude, últimas 7 rodadas 'ok').
import assert from 'node:assert/strict';
import { travaDoSweep, medianaTotais, pisoEnumeracao, demaisParaUmaRodada, sumidosLiberados } from '../lib/sweep-trava.mjs';

assert.equal(medianaTotais([{ total: 39 }, { total: 47 }, { total: 38 }, { total: 35 }, { total: 35 }]), 38);
assert.equal(medianaTotais([{ total: 10 }, { total: 20 }]), 15);
assert.equal(medianaTotais([{ total: 0 }, { total: null }]), 0);   // rodada vazia não é tamanho de fonte
assert.equal(medianaTotais(null), 0);

// VIP — o caso que motivou: 95 ativos, 74 "sem lance" na janela de 15 dias (o sweep não toca), 16 varríveis.
// A rodada grava os 39 que o site lista. Régua antiga: 39 < 95 × 0,5 → sweep pulado todo dia.
const antiga = travaDoSweep({ salvos: 39, coletados: 39, ativosAntes: 95, varriveisAntes: 16, totalRecente: null });
assert.equal(antiga.bloqueado, true, 'sem histórico, vale a régua antiga (conservadora)');
const vip = travaDoSweep({ salvos: 39, coletados: 39, ativosAntes: 95, varriveisAntes: 16, totalRecente: 35 });
assert.equal(vip.bloqueado, false, 'VIP com a lista inteira tem que varrer');

// O RISCO que a trava protege continua coberto: a mesma VIP com a lista cortada (10 de ~38). Só com
// "varríveis" no denominador, 10 ≥ 16 × 0,5 passaria e desligaria lote vivo — a mediana do coletado segura.
const cortada = travaDoSweep({ salvos: 10, coletados: 10, ativosAntes: 95, varriveisAntes: 16, totalRecente: 35 });
assert.equal(cortada.bloqueado, true);
assert.match(cortada.motivo, /mediana 35/);

// Coletado × gravado NÃO se mistura (forma nº 10): FRAZAO coleta ~192 e tem 28 ativos; LJUD coleta ~1.391
// e tem 770. Nenhuma das duas pode passar a ser bloqueada por comparar o coletado com o acervo.
assert.equal(travaDoSweep({ salvos: 28, coletados: 192, ativosAntes: 28, varriveisAntes: 28, totalRecente: 150 }).bloqueado, false);
assert.equal(travaDoSweep({ salvos: 760, coletados: 1391, ativosAntes: 770, varriveisAntes: 752, totalRecente: 1398 }).bloqueado, false);
// …e o SUPERBID de 20/09 (paginação cortada na pág. 3: 200 de ~1.450) continua barrado pelas DUAS pernas.
const sbid = travaDoSweep({ salvos: 200, coletados: 200, ativosAntes: 1242, varriveisAntes: 1231, totalRecente: 1297 });
assert.equal(sbid.bloqueado, true);
assert.match(sbid.motivo, /varríveis/);

// Fonte nova (sem rodada sadia ainda): mediana 0 → só a perna dos varríveis decide.
assert.equal(travaDoSweep({ salvos: 5, coletados: 5, ativosAntes: 6, varriveisAntes: 6, totalRecente: 0 }).bloqueado, false);
assert.equal(travaDoSweep({ salvos: 2, coletados: 2, ativosAntes: 6, varriveisAntes: 6, totalRecente: 0 }).bloqueado, true);
// Varríveis ilegível (erro na contagem) também cai na régua antiga.
assert.equal(travaDoSweep({ salvos: 39, coletados: 39, ativosAntes: 95, varriveisAntes: null, totalRecente: 35 }).bloqueado, true);

// Sitemap (scraper-pecini.mjs). PECINI real 19–23/10: enumerados 50, 39, 38, 43, 38, 38, 38 — com o piso fixo
// 40, 5 de 7 rodadas PULAVAM a varredura. Relativo: piso 19 (metade da mediana 38).
const pec = pisoEnumeracao([38, 38, 38, 43, 38, 39, 50].map(enumerados => ({ enumerados })), 40);
assert.equal(pec.piso, 19);
assert.ok(38 >= pec.piso);
assert.ok(!(12 >= pec.piso), 'sitemap cortado (12 de ~38) continua barrado');
// SUBLIME real: 110–115 enumerados → piso 56.
assert.equal(pisoEnumeracao([110, 115, 112, 112, 112].map(enumerados => ({ enumerados })), 40).piso, 56);
// Histórico curto ou ilegível: piso fixo.
assert.deepEqual(pisoEnumeracao([{ enumerados: 52 }], 40), { piso: 40, via: 'fixo' });
assert.deepEqual(pisoEnumeracao(null, 40), { piso: 40, via: 'fixo' });
// Freio de quantidade: 3 de 45 sai; 30 de 45 de uma vez é lista ruim; fonte pequena tolera até 5.
assert.equal(demaisParaUmaRodada(3, 45), false);
assert.equal(demaisParaUmaRodada(30, 45), true);
assert.equal(demaisParaUmaRodada(5, 6), false);
assert.equal(demaisParaUmaRodada(6, 6), true);

console.log('sweep-trava: todos os casos passaram');

// FREIO QUE NÃO DESTRAVA (26/10) — GIORDANOLEILOES real: 23 ativos, 14 fora da lista (atualizado_em de 23/09 a 20/10),
// a lista do site com 99 (histórico de enumerados 96–99). Antes: "demais para uma rodada" todo dia, para sempre.
{
  const agora = Date.parse('2026-10-26T15:48:51Z');
  const parados = ['2026-09-23T13:54:21Z', '2026-09-24T13:51:21Z', '2026-09-30T15:08:38Z', '2026-10-09T15:28:59Z', '2026-10-20T13:55:25Z']
    .map((atualizado_em, i) => ({ id: i, atualizado_em }));
  const fora = [...parados, { id: 99, atualizado_em: '2026-10-26T01:00:00Z' }];   // um que sumiu SÓ hoje fica
  const hist = [{ enumerados: 96 }, { enumerados: 99 }, { enumerados: 97 }, { enumerados: 99 }];
  const r = sumidosLiberados({ fora, ativos: 9, enumerados: 99, historico: hist, agora });
  assert.deepEqual(r.liberar.map(a => a.id), [0, 1, 2, 3, 4], 'saem só os parados há 3+ dias');
  // lista ENCOLHIDA hoje (30 de ~98): ninguém sai — é a lista ruim que o freio existe para pegar
  assert.equal(sumidosLiberados({ fora, ativos: 9, enumerados: 30, historico: hist, agora }).liberar.length, 0);
  // sem histórico legível: na dúvida, não desliga
  assert.equal(sumidosLiberados({ fora, ativos: 9, enumerados: 99, historico: [], agora }).liberar.length, 0);
  // abaixo do freio: comportamento de sempre (todos os de fora saem)
  assert.equal(sumidosLiberados({ fora: fora.slice(0, 2), ativos: 23, enumerados: 99, historico: hist, agora }).liberar.length, 2);
  console.log('✓ sumidos acima do freio: saem só os parados, com a lista inteira');
}

