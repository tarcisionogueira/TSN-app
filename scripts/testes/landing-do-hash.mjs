/**
 * scripts/testes/landing-do-hash.mjs — a rota que o `landing` grava, e a que ele NÃO pode gravar.
 *
 * POR QUE EXISTE (30/08). O app é HashRouter e o redirecionamento de `/aula/<slug>`
 * (api/og-share.js) acrescenta as utm DEPOIS do "#". Quem chega por anúncio carrega
 * `/#/live/<slug>?utm_source=meta&...` — ou seja, exatamente o tráfego pago é o que traz "="
 * no hash. A primeira trava anti-token descartava o hash inteiro nesse caso, e o `landing`
 * saía "/" para a campanha toda. Eu li isso como "a campanha manda todo mundo para a home" e
 * dei diagnóstico errado ao dono, com número plausível — a forma #10 do CLAUDE.md.
 *
 * As duas metades têm que valer JUNTAS, e é isso que este teste trava: a rota sobrevive à
 * query, e o token de sessão do Supabase continua fora. Passar em uma só é como não passar.
 *
 * Roda com: node scripts/testes/landing-do-hash.mjs
 * (importa `src/utils/marketing.js`, que lê `import.meta.env` — use `npx vite-node` se o
 *  node puro reclamar; a função em si não depende de env.)
 */
import { rotaDoHash } from '../../src/utils/marketing.js';
const casos = [
  // [hash, esperado, o que é]
  ['#/live/leilao-ao-vivo?utm_source=meta&utm_campaign=aula-02set&fbclid=IwAR123', '#/live/leilao-ao-vivo', 'o caso da campanha (og-share põe as utm depois do #)'],
  ['#/live/leilao-ao-vivo', '#/live/leilao-ao-vivo', 'link direto da aula'],
  ['#/calculadora?ref=ABC123', '#/calculadora', 'link do parceiro'],
  ['#/planos', '#/planos', 'rota simples'],
  ['#/', '#/', 'raiz do app'],
  ['', '', 'sem hash (página SEO)'],
  ['#access_token=eyJhbGciOi.PAYLOAD.SIG&refresh_token=xyz&type=recovery', '', 'TOKEN do Supabase — o vazamento de hoje de manhã'],
  ['#/redefinir-senha#access_token=eyJhbGciOi.PAYLOAD.SIG', '#/redefinir-senha', 'rota + token grudado: fica a rota, some o token'],
  ['#error=unauthorized&error_description=x', '', 'erro do OAuth'],
  ['#/imovel/2bab8679-adc7-459d-8dd4-aea3c647b6ab', '#/imovel/2bab8679-adc7-459d-8dd4-aea3c647b6ab', 'uuid na rota'],
];
let mau = 0;
for (const [h, esp, oque] of casos) {
  const got = rotaDoHash(h);
  const ok = got === esp;
  if (!ok) mau++;
  console.log(`${ok ? '✓' : '✗'}  ${oque}\n     ${JSON.stringify(h).slice(0,72)}\n     → ${JSON.stringify(got)}${ok ? '' : `  (esperado ${JSON.stringify(esp)})`}`);
}
console.log(mau ? `\n${mau} FALHA(S)` : `\n${casos.length}/${casos.length} OK`);
process.exit(mau ? 1 : 0);
