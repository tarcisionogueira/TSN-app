/**
 * scripts/testes/erro-so-de-producao.mjs — preview e localhost não viram "erro de cliente".
 *
 * POR QUE EXISTE (30/08). Um `column perfis.email does not exist` vindo de um deploy de PREVIEW
 * entrou em `erros_cliente` e contou em `clientes_com_erro`, que o Cliente 360 mostra ao dono
 * como "clientes com erro". Ninguém de fora viu aquilo. O número existia, era plausível, e media
 * outra coisa — a forma #10 do CLAUDE.md, dentro do próprio medidor de saúde. E custou uma
 * varredura no código atual, em cinco commits anteriores e no histórico do arquivo antes de o
 * campo `url` entregar a resposta.
 *
 * O caso que este teste existe para não deixar passar é o último: `bidprobrasil.com.br.evil.com`
 * PARECE o domínio e não pode passar. Comparação de hostname tem que ser igualdade, nunca
 * `includes` — senão a trava contra ruído vira a porta.
 *
 * `ehProducao` precisa estar exportada de src/utils/reportarErro.js para este teste rodar.
 */
import { ehProducao } from '../../src/utils/reportarErro.js';
const casos = [
  ['https://www.bidprobrasil.com.br/#/imovel/abc', true,  'produção com www'],
  ['https://bidprobrasil.com.br/#/planos',          true,  'produção sem www'],
  ['https://tsn-app-git-claude-bidpro-b-eb61e3-tarcisio-nogueira-s-projects.vercel.app/#/admin', false, 'PREVIEW — o caso de 29/08'],
  ['https://tsn-ndv9sbnqg-tarcisio-nogueira-s-projects.vercel.app/#/admin', false, 'deploy direto da Vercel'],
  ['http://127.0.0.1:5199/#/login',                 false, 'localhost'],
  ['',                                             false, 'href vazio'],
  ['nao-e-url',                                    false, 'href inválido'],
  ['https://bidprobrasil.com.br.evil.com/#/',      false, 'domínio parecido (não pode passar)'],
];
let mau=0;
for (const [href, esp, oque] of casos) {
  const got = ehProducao(href);
  const ok = got === esp; if (!ok) mau++;
  console.log(`${ok?'✓':'✗ FALHOU'}  ${oque}\n     ${JSON.stringify(href).slice(0,72)} → ${got}${ok?'':`  (esperado ${esp})`}`);
}
console.log(mau ? `\n${mau} FALHA(S)` : `\n${casos.length}/${casos.length} OK`);
process.exit(mau?1:0);
