/**
 * npm run testar:datas-ljud — datas da LJUD (leiloesjudiciais.com.br) em api/enriquecer-lote.js.
 * Trechos das páginas REAIS do recon de 24/09 (lotes 99869/218709 e 99855/218651). O genérico dava
 * início = HOJE (data escondida no HTML) e fim = um "Ciclo" de venda posterior.
 */
import { extrairDatasLeilao } from '../../api/enriquecer-lote.js';

let falhas = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { falhas++; console.log(`  ✗ ${m}`); } };
const pagina = (corpo) => `<html><head><link rel="canonical" href="https://www.leiloesjudiciais.com.br/lote/1/2"><script>var agora="24/09/2026 15:56";</script></head><body>${corpo}</body></html>`;

const duas = extrairDatasLeilao(pagina('Condições de venda 3 lote(s) em BA 1º Encerramento - 13/10/2099 11:00 2º Encerramento - 20/10/2099 11:00 Venda direta 1º Ciclo - 04/11/2099 16:00 2º Ciclo - 19/11/2099 16:00 3º Ciclo - 04/12/2099 16:00'));
ok(duas.inicio === '2099-10-13', `início = 1º encerramento (${duas.inicio})`);
ok(duas.fim === '2099-10-20T14:00:00.000Z', `fim = 2º encerramento, não o ciclo (${duas.fim})`);

const uma = extrairDatasLeilao(pagina('15 lote(s) em RJ Encerramento - 30/09/2099 10:00 voltar para o leilão'));
ok(uma.inicio === '2099-09-30' && uma.fim === null, `encerramento único → início, sem 2ª praça (${uma.inicio} / ${uma.fim})`);

const passada = extrairDatasLeilao(pagina('1º Encerramento - 13/08/2020 11:00 2º Encerramento - 20/08/2020 11:00'));
ok(passada.encerradaEm === '2020-08-20' && passada.inicio === null, 'datas passadas → encerradaEm (a última praça)');

ok(extrairDatasLeilao(pagina('sem rótulo nenhum 24/09/2026')).inicio === null, 'sem rótulo → nada (não cai no genérico)');

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
