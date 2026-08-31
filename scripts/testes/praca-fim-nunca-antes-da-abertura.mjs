/**
 * scripts/testes/praca-fim-nunca-antes-da-abertura.mjs — a guarda de `roteiarDatasPraca`
 * compara contra a ABERTURA, não contra a meia-noite do dia.
 *
 * POR QUE EXISTE (31/08). `roteiarDatasPraca` tem uma guarda explícita — `enc >= inicioP1` —
 * cujo comentário diz, com todas as letras, que ela existe para "evitar gravar um encerramento
 * anterior à abertura". Ela não evitava: o `inicioP1` era construído com
 * `data_leilao.slice(0, 10) + 'T00:00:00-03:00'`, ou seja, a MEIA-NOITE do dia do leilão.
 * Qualquer encerramento no dia certo passa por "depois da meia-noite".
 *
 * O placar medido era 2 de 2 — os únicos lotes do LJUD com `praca1_fim` preenchido, os dois
 * inválidos. É a forma #10 dentro de uma guarda: o número comparado era real e plausível, e
 * media o dia em vez do instante.
 *
 * Os dois primeiros casos abaixo são esses lotes, com os valores exatos que estavam no banco.
 */
import { roteiarDatasPraca } from '../../api/enriquecer-lote.js';

const casos = [
  // ── os dois lotes reais do LJUD (id truncado no nome) ─────────────────────────────────
  { oque: 'LJUD Ribeirão Preto: abre 13:28, edital diz encerra 13:00 — 28 min ANTES',
    datas: { encerramento: '2026-09-17T13:00:00-03:00' },
    im:    { data_leilao: '2026-09-17T13:28:00-03:00' },
    esperaPraca1Fim: false },
  { oque: 'LJUD Cananéia: abre 09:16, edital diz encerra 00:00 — 9 h ANTES',
    datas: { encerramento: '2026-09-17T00:00:00-03:00' },
    im:    { data_leilao: '2026-09-17T09:16:00-03:00' },
    esperaPraca1Fim: false },

  // ── o caso legítimo NÃO pode ser barrado junto (a guarda não vira mordaça) ────────────
  { oque: 'encerramento DEPOIS da abertura, mesmo dia — tem de gravar',
    datas: { encerramento: '2026-09-17T18:00:00-03:00' },
    im:    { data_leilao: '2026-09-17T13:28:00-03:00' },
    esperaPraca1Fim: true },
  { oque: 'encerramento dias depois da abertura — tem de gravar',
    datas: { encerramento: '2026-09-25T16:00:00-03:00' },
    im:    { data_leilao: '2026-09-17T13:28:00-03:00' },
    esperaPraca1Fim: true },

  // ── data SECA continua funcionando pela meia-noite construída ─────────────────────────
  // `Date.parse('2026-09-03')` assume UTC = 21:00 de 02/09 em BRT. Se a data seca deixasse
  // de ganhar o `T00:00:00-03:00`, a guarda AFROUXARIA em 3 h justamente aqui.
  { oque: 'data seca + encerramento no mesmo dia de tarde — grava',
    datas: { encerramento: '2026-09-03T16:00:00-03:00' },
    im:    { data_leilao: '2026-09-03' },
    esperaPraca1Fim: true },
  { oque: 'data seca + encerramento na VÉSPERA à noite — NÃO grava (o furo do UTC)',
    datas: { encerramento: '2026-09-02T22:00:00-03:00' },
    im:    { data_leilao: '2026-09-03' },
    esperaPraca1Fim: false },

  // ── sem abertura conhecida: a guarda não tem contra o que comparar, então grava ───────
  { oque: 'sem data_leilao e sem datas.inicio — grava (nada a contradizer)',
    datas: { encerramento: '2026-09-17T13:00:00-03:00' },
    im:    {},
    esperaPraca1Fim: true },
];

let mau = 0;
for (const c of casos) {
  const patch = roteiarDatasPraca(c.datas, c.im);
  const gravou = patch.praca1_fim != null;
  const ok = gravou === c.esperaPraca1Fim;
  if (!ok) mau++;
  console.log(`${ok ? '  ok  ' : '  FALHOU '} praca1_fim=${gravou ? patch.praca1_fim : '(nao gravou)'} `
    + `· esperado ${c.esperaPraca1Fim ? 'gravar' : 'NAO gravar'} · ${c.oque}`);
}

if (mau) {
  console.error(`\n❌ ${mau} caso(s) fora do esperado em roteiarDatasPraca.`);
  process.exit(1);
}
console.log(`\n✅ ${casos.length} casos: encerramento anterior à abertura não é mais gravado.`);
