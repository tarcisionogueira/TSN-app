/**
 * npm run testar:pracas-suporte — 1ª e 2ª praça na COLETA da Suporte Leilões (JELEILOES/KLEILOES),
 * scripts/lib/jeleiloes-parse.mjs. Trechos das páginas reais do recon de 24/09.
 */
import { parseDetalhe } from '../lib/jeleiloes-parse.mjs';

let falhas = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { falhas++; console.log(`  ✗ ${m}`); } };
const h = (t) => `<html><head><title>Imóvel</title></head><body>${t}</body></html>`;
const KL = 'https://kleiloes.com.br/oferta/leilao/imoveis/apartamento/1/id-2/x';
const JE = 'https://jeleiloes.com.br/oferta/leilao/imoveis/casas/1/id-4/x';

const a = parseDetalhe(h('Data 23/09/2026 10:00 (1º Leilão) Online 07/10/2026 10:00 (2º Leilão) Online'), KL);
ok(a.data_leilao === '2026-09-23' && a.data_leilao_2 === '2026-10-07T10:00:00-03:00', `KLEILOES 1ª e 2ª praça (${a.data_leilao} / ${a.data_leilao_2})`);
const b = parseDetalhe(h('Título SICREDI DEXIS Data Até 23/10/2026 Bens em venda direta'), KL);
ok(b.data_leilao === '2026-10-23' && b.data_leilao_2 === null, `KLEILOES venda direta "Data Até" (${b.data_leilao})`);
const c = parseDetalhe(h('Data 1º Leilão: 23/09/2026 - Encerramento a partir das 10:00 (Somente pela internet) Data 2º Leilão: 30/09/2026 - Encerramento a partir das 14:00'), JE);
ok(c.data_leilao === '2026-09-23' && c.data_leilao_2 === '2026-09-30T14:00:00-03:00', `JELEILOES 1º/2º Leilão (${c.data_leilao} / ${c.data_leilao_2})`);
const d = parseDetalhe(h('Data Leilão único: 16/09/2026 - Encerramento a partir das 10:00'), JE);
ok(d.data_leilao === '2026-09-16' && d.data_leilao_2 === null, `JELEILOES leilão único (${d.data_leilao})`);

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
