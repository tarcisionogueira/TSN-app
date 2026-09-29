/**
 * scripts/testes/zero-declarado-pelo-site.mjs
 *
 * POR QUE EXISTE (29/09). A HASTA acusou `zerou` em fonte_regressao_suspeita() por 30 dias com o
 * site afirmando, em todo evento, "NENHUM LOTE ENCONTRADO NO MOMENTO" (HTML em recon_dump,
 * origem motor-vazio). O SOLEON já gravava "site declara…" desde 28/09; o motor genérico não.
 * Alarme que toca todo dia por fonte sã esconde a regressão de verdade.
 *
 * Tranca: (a) todos os eventos declaram → vazioDeclarado; (b) um evento NÃO ABRIU → não declara
 * (não consegui ver ≠ o site disse); (c) um evento sem o texto → não declara; (d) fonte de
 * nível 1 com o texto no catálogo → declara; (e) o motivo começa com "site declara" (contrato
 * com o ilike da função SQL).
 */
import { enumerar } from '../lib/motor/runner.mjs';
import { MOTIVO_VAZIO_DECLARADO } from '../lib/vazio-declarado.mjs';

let falhas = 0;
const ok = (cond, oque) => { if (cond) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };

const VAZIO = '<div><h3>Lista de Lotes desse Leilão</h3><p>\n  NENHUM LOTE ENCONTRADO NO MOMENTO </p></div>';
const cfg = (nivel2) => ({
  catalogo: '/leiloes', paginaParam: 'page', maxEventos: 12, maxPagesEvento: 3,
  parse: {
    extrairUrlsDeLote: (html) => new Map(String(html).includes('/item/7/') ? [['7', 'https://x.test/item/7/detalhes']] : []),
    ...(nivel2 && { extrairUrlsDeEvento: () => new Map([['a', 'https://x.test/leilao/1/lotes'], ['b', 'https://x.test/leilao/2/lotes']]) }),
  },
});
const tenant = { fonte: 'TESTE', base: 'https://x.test' };
const rodar = (c, paginas) => enumerar(async (url) => ({ html: paginas[url] ?? null, via: 'gratis' }), tenant, c, { maxPages: 3, debug: false, semBD: false });
const CAT = 'https://x.test/leiloes', E1 = 'https://x.test/leilao/1/lotes', E2 = 'https://x.test/leilao/2/lotes';

console.log('\nzero declarado pelo site');
ok((await rodar(cfg(true), { [CAT]: 'Em Breve', [E1]: VAZIO, [E2]: VAZIO })).vazioDeclarado === true, 'todos os eventos declaram → vazioDeclarado');
ok((await rodar(cfg(true), { [CAT]: 'Em Breve', [E1]: VAZIO })).vazioDeclarado === false, 'um evento não abriu → não declara');
ok((await rodar(cfg(true), { [CAT]: 'Em Breve', [E1]: VAZIO, [E2]: '<div>carregando…</div>' })).vazioDeclarado === false, 'um evento sem o texto → não declara');
ok((await rodar(cfg(false), { [CAT]: VAZIO })).vazioDeclarado === true, 'nível 1: catálogo declara → vazioDeclarado');
ok((await rodar(cfg(false), { [CAT]: '<a href="/item/7/">x</a>' })).vazioDeclarado === false, 'com lote → não declara');
ok(/^site declara/i.test(MOTIVO_VAZIO_DECLARADO), 'motivo começa com "site declara" (contrato com fonte_regressao_suspeita)');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
