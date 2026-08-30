#!/usr/bin/env node
/**
 * TESTE — `planejarAlvo` do motor (orçamento de releitura). 29/08
 *
 * POR QUE ESTE ARQUIVO EXISTE: a conta que ele exercita decide GASTO. Um off-by-one em
 * `iReleitura` faz o guard "releitura nunca paga" mirar no lote errado; um erro no `folga`
 * estoura o teto por fonte; um `sort` instável faz o acervo reler sempre os mesmos e nunca
 * ciclar. Nada disso quebra o build, aparece em lint, nem falha o run — sai um número
 * plausível e mais caro. É a forma nº 10 aplicada a orçamento.
 *
 * Roda em seco, sem rede e sem banco. `npm run testar:motor`
 */
// Importa a função de PRODUÇÃO — um teste com cópia da lógica mede a cópia.
import { planejarAlvo } from '../lib/motor/runner.mjs';

const AGORA = Date.parse('2026-08-29T22:00:00Z');
const dia = (n) => new Date(AGORA + n * 864e5).toISOString().slice(0, 10);
const chaveDe = (u) => `f_${u}`;
const metaDe = (defs) => new Map(defs.map(d => [`f_${d.u}`,
  { fonte_id: `f_${d.u}`, atualizado_em: d.tocado, data_fim: d.fim ?? null, ativo: d.ativo !== false }]));

let falhas = 0;
const eq = (nome, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) falhas++;
  console.log(`${ok ? '✓' : '✗ FALHOU'} ${nome}${ok ? '' : `\n     obtido: ${JSON.stringify(a)}\n   esperado: ${JSON.stringify(b)}`}`);
};

// 1) Fonte NUNCA coletada — comportamento antigo, nenhuma releitura
{
  const r = planejarAlvo({ urls: ['a','b','c'], meta: new Map(), chaveDe, maxLotes: 40, agora: AGORA });
  eq('fonte nova: alvo = novos, releitura vazia', [r.alvo, r.releitura, r.iReleitura], [['a','b','c'], [], 3]);
}
// 2) Coletada, poucos novos — a SOBRA vira releitura, sem passar do teto
{
  const meta = metaDe([{u:'b',tocado:'2026-08-25T00:00:00Z'},{u:'c',tocado:'2026-08-20T00:00:00Z'}]);
  const r = planejarAlvo({ urls: ['a','b','c'], meta, chaveDe, maxLotes: 3, agora: AGORA });
  eq('sobra vira releitura (mais velho primeiro)', [r.alvo, r.iReleitura], [['a','c','b'], 1]);
}
// 3) Novos ENCHEM o teto — releitura zero, novo nunca perde vaga
{
  const meta = metaDe([{u:'x',tocado:'2026-01-01T00:00:00Z'}]);
  const r = planejarAlvo({ urls: ['a','b','c','x'], meta, chaveDe, maxLotes: 2, agora: AGORA });
  eq('novos enchem o teto: 0 releitura', [r.alvo, r.releitura, r.iReleitura], [['a','b'], [], 2]);
}
// 4) O teto TOTAL nunca é ultrapassado
{
  const meta = metaDe(Array.from({length: 100}, (_, i) => ({ u: `k${i}`, tocado: '2026-08-01T00:00:00Z' })));
  const urls = ['n1','n2', ...Array.from({length:100},(_,i)=>`k${i}`)];
  const r = planejarAlvo({ urls, meta, chaveDe, maxLotes: 40, agora: AGORA });
  eq('teto respeitado (2 novos + 38 releitura = 40)', [r.alvo.length, r.releitura.length, r.iReleitura], [40, 38, 2]);
}
// 5) maxRefresh: 0 desliga a releitura na fonte
{
  const meta = metaDe([{u:'b',tocado:'2026-08-01T00:00:00Z'}]);
  const r = planejarAlvo({ urls: ['a','b'], meta, chaveDe, maxLotes: 40, maxRefresh: 0, agora: AGORA });
  eq('maxRefresh:0 desliga', [r.alvo, r.releitura], [['a'], []]);
}
// 6) PRAÇA IMINENTE passa na frente do mais velho
{
  const meta = metaDe([
    { u: 'velho_longe',   tocado: '2026-01-01T00:00:00Z', fim: dia(90) },
    { u: 'novo_iminente', tocado: '2026-08-29T00:00:00Z', fim: dia(5)  },
  ]);
  const r = planejarAlvo({ urls: ['velho_longe','novo_iminente'], meta, chaveDe, maxLotes: 1, agora: AGORA });
  eq('praça iminente antes do mais velho', r.releitura, ['novo_iminente']);
}
// 7) Lote INATIVO não volta pela releitura
{
  const meta = metaDe([{ u:'morto', tocado:'2026-01-01T00:00:00Z', ativo:false }, { u:'vivo', tocado:'2026-08-01T00:00:00Z' }]);
  const r = planejarAlvo({ urls: ['morto','vivo'], meta, chaveDe, maxLotes: 40, agora: AGORA });
  eq('inativo fora da releitura', r.releitura, ['vivo']);
}
// 8) Determinístico: mesma entrada, mesma saída (senão o acervo nunca cicla)
{
  const meta = metaDe([{u:'a',tocado:'2026-08-01T00:00:00Z'},{u:'b',tocado:'2026-08-01T00:00:00Z'}]);
  const um = planejarAlvo({ urls:['a','b'], meta, chaveDe, maxLotes: 1, agora: AGORA });
  const dois = planejarAlvo({ urls:['b','a'], meta, chaveDe, maxLotes: 1, agora: AGORA });
  eq('empate de data desempata estável', um.releitura, dois.releitura);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\n8/8 cenários passam');
process.exit(falhas ? 1 : 0);
