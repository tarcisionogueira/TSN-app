// PRAÇA VENCIDA NA ENTRADA (26/10, #357). Casos reais do LJUD: ljud_veic_222921 (praça 09/10 18:15 UTC) foi CRIADO
// em 22/10 com `ativo: true` — fora da janela de apuração de 10 dias, nunca seria apurado — e o que a limpeza
// desligava voltava na rodada seguinte. salvarVeiculos agora grava inativo o lote NOVO (ou já desligado) cuja praça
// passou há 2+ dias; este teste fixa a régua de "vencida".
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL ||= 'https://teste.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'chave-teste';
const { vencidaHa2Dias } = await import('../scraper-puppeteer.mjs');

const em = (iso) => Date.parse(iso);
// 22/10 16:55 UTC (criado_em do 222921): praça de 09/10 → vencida
assert.equal(vencidaHa2Dias('2026-10-09T18:15:00+00:00', em('2026-10-22T16:55:22Z')), true);
// 279dba05 (praça 21/10 15:15), criado 24/10 15:39 → 3 dias: vencida
assert.equal(vencidaHa2Dias('2026-10-21T15:15:00+00:00', em('2026-10-24T15:39:59Z')), true);
// praça de ontem: dentro da folga de 2 dias (a apuração ainda vai passar) → não mexe
assert.equal(vencidaHa2Dias('2026-10-25T15:00:00+00:00', em('2026-10-26T18:00:00Z')), false);
// futura, nula ou ilegível → não vencida (na dúvida, o coletor não desliga)
assert.equal(vencidaHa2Dias('2026-10-30T15:00:00Z', em('2026-10-26T18:00:00Z')), false);
assert.equal(vencidaHa2Dias(null), false);
assert.equal(vencidaHa2Dias('a definir'), false);
console.log('✓ veículo: praça vencida há 2+ dias não nasce nem volta ativo');
