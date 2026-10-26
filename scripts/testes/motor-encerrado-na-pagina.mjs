// ENCERRADO NA PÁGINA (26/10, #277): lote ATIVO que a releitura acha encerrado sai do acervo — mas só quando o banco
// não conhece praça futura. Linhas REAIS de 26/10 (imoveis_leilao).
import assert from 'node:assert/strict';
const { classificarEncerrados } = await import('../lib/motor/runner.mjs');
const agora = Date.parse('2026-10-26T15:44:08Z');

// GIORDANOLEILOES 219127: judicial sem data nenhuma, parado desde 23/09 — nunca expiraria pela limpeza por data.
// RAFAELLEILOEIRO 1014: 1º leilão 20/10, 2º 27/10 no banco, e a página "encerrado" (lote.status 2) → conflito, fica.
// Retido na janela de proposta (sem lance apurado há 3 dias) → fica, nem conflito.
// Praça de 20/10 já passada e página encerrada → sai.
const r = classificarEncerrados([
  { id: 'giordano_219127', data_leilao: null, data_leilao_2: null, data_fim: null, resultado_leilao: null },
  { id: 'rafael_1014', data_leilao: '2026-10-20T10:00:00-03:00', data_leilao_2: '2026-10-27 15:00:00+00', data_fim: '2026-10-27', resultado_leilao: null },
  { id: 'retido', data_leilao: '2026-10-20T10:00:00-03:00', resultado_leilao: 'sem_lance', resultado_apurado_em: '2026-10-23T12:00:00Z' },
  { id: 'vencido', data_leilao: '2026-10-20T10:00:00-03:00', data_leilao_2: null, data_fim: '2026-10-20', resultado_leilao: null },
], agora);
assert.deepEqual(r.ids, ['giordano_219127', 'vencido']);
assert.deepEqual(r.conflito, ['rafael_1014']);
// data_fim de HOJE ainda vale até o fim do dia
assert.deepEqual(classificarEncerrados([{ id: 'hoje', data_fim: '2026-10-26' }], agora).conflito, ['hoje']);
console.log('✓ motor: encerrado na página sai do acervo; praça futura no banco é conflito e fica');
