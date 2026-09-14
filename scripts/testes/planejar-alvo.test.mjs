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
  { fonte_id: `f_${d.u}`, atualizado_em: d.tocado, data_fim: d.fim ?? null, ativo: d.ativo !== false,
    link_foto: d.foto ? 'https://x/y.jpg' : null }]));

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

// 9) SEM FOTO fura a fila do mais-velho (achado 14/09: GIORDANOLEILOES 47% sem foto porque um
//    lote que falha em pegar a foto ainda "envelhece" normal e nunca é priorizado de volta)
{
  const meta = metaDe([
    { u: 'velho_com_foto', tocado: '2026-01-01T00:00:00Z', foto: true },
    { u: 'novo_sem_foto',  tocado: '2026-08-29T00:00:00Z', foto: false },
  ]);
  const r = planejarAlvo({ urls: ['velho_com_foto','novo_sem_foto'], meta, chaveDe, maxLotes: 1, agora: AGORA });
  eq('sem foto (mesmo mais novo) fura a fila do mais velho', r.releitura, ['novo_sem_foto']);
}
// 10) O TETO do furo-de-fila não deixa uma fonte 100% sem foto sequestrar a releitura inteira —
//     além do teto, volta a valer a ordem normal (mais velho primeiro)
{
  const semFoto = Array.from({ length: 20 }, (_, i) => ({ u: `sf${i}`, tocado: '2026-08-01T00:00:00Z', foto: false }));
  const comFotoVelho = { u: 'com_foto_bem_velho', tocado: '2026-01-01T00:00:00Z', foto: true };
  const meta = metaDe([...semFoto, comFotoVelho]);
  const urls = [...semFoto.map(d => d.u), comFotoVelho.u];
  const r = planejarAlvo({ urls, meta, chaveDe, maxLotes: 21, agora: AGORA });
  // 20 sem-foto > teto de 15 furam a fila; o mais velho com foto (fora do teto) ainda entra
  // antes dos 5 sem-foto que sobraram do lado de fora do furo.
  const semFotoNaFrente = r.releitura.slice(0, 15).every(u => u.startsWith('sf'));
  eq('teto do furo respeitado (15 sem-foto na frente, resto some pela ordem normal)', semFotoNaFrente, true);
  eq('mais velho com foto entra antes do resto de sem-foto que ficou de fora do teto',
    r.releitura[15], 'com_foto_bem_velho');
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\n10/10 cenários passam');
process.exit(falhas ? 1 : 0);
