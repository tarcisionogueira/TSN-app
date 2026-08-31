/**
 * scripts/testes/quem-pagou-para-ver-a-aula-nao-cai-na-home.mjs
 *
 * POR QUE EXISTE (31/08). Medido em `visita_origem`, sobre todo o tráfego pago da aula:
 * **22 visitas caíram na HOME contra 11 que chegaram na página da aula** — dois terços do
 * dinheiro do anúncio entregando a pessoa no lugar errado, porque o navegador embutido do
 * Instagram corta o que vem depois do "#" e `/#/live/<slug>` vira `/`.
 *
 * O QUE ESTE TESTE SEGURA, e são três coisas que só se veem quando dão errado em produção:
 *   1. O resgate SÓ pode agir na raiz. Redirecionar alguém que já escolheu uma rota é sequestro
 *      de navegação — e aconteceria justamente com quem chegou pelo link certo.
 *   2. A QUERY STRING tem de ir junto. Sem ela o `fbclid` e os UTMs se perdem no salto, e o
 *      tráfego pago passaria a chegar na aula SEM ORIGEM: trocaríamos perda de conversão por
 *      perda de medição, com o número parecendo ótimo. É a forma #10 esperando acontecer.
 *   3. Campanha desconhecida NÃO redireciona. Ficar na home é ruim; mandar para uma rota que
 *      não existe é pior.
 */
import { destinoDaCampanha, estaNaRaiz, slugDaCampanha } from '../../src/utils/destinoDaCampanha.js';

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\nO CASO REAL — o clique que caía na home');
// A URL exata que o tracker registrou em 30/08 16:43, com o fragmento já cortado.
const real = { pathname: '/', hash: '', search: '?utm_source=meta&utm_medium=cpc&utm_campaign=aula-02set&utm_content=REEL-2808-LIVE&fbclid=IwcGRvZgVleHRuA2FlbQEwAGFkaWQB' };
const destino = destinoDaCampanha(real);
ok(destino !== null, 'o clique perdido é resgatado');
ok(String(destino).startsWith('/#/live/leilao-ao-vivo?'), 'vai para a página da aula', String(destino));
ok(String(destino).includes('fbclid=IwcGRvZgVleHRuA2FlbQEwAGFkaWQB'), 'o fbclid sobrevive ao salto');
ok(String(destino).includes('utm_campaign=aula-02set'), 'os UTMs sobrevivem ao salto');

console.log('\nSÓ NA RAIZ — nunca sequestra quem já escolheu rota');
ok(estaNaRaiz('/', '') === true, 'raiz nua');
ok(estaNaRaiz('/', '#/') === true, 'raiz com hash vazio');
ok(estaNaRaiz('/', '#/live/leilao-ao-vivo') === false, 'quem JÁ está na aula não é mexido');
ok(estaNaRaiz('/', '#/buscar') === false, 'quem está na busca não é mexido');
ok(estaNaRaiz('/aula/leilao-ao-vivo', '') === false, 'a rota sem "#" (og-share) não é mexida');
for (const caso of [
  { oque: 'já na aula, com os mesmos UTMs', url: { pathname: '/', hash: '#/live/leilao-ao-vivo', search: '?utm_campaign=aula-02set' } },
  { oque: 'em outra tela do app',           url: { pathname: '/', hash: '#/buscar', search: '?utm_campaign=aula-02set' } },
  { oque: 'na rota /aula/ sem hash',        url: { pathname: '/aula/leilao-ao-vivo', hash: '', search: '?utm_campaign=aula-02set' } },
]) ok(destinoDaCampanha(caso.url) === null, `não redireciona: ${caso.oque}`);

console.log('\nCAMPANHA DESCONHECIDA FICA ONDE ESTÁ');
for (const c of ['', null, 'trf-site-leiloes', 'black-friday', 'aula', 'AULAS-2027']) {
  ok(destinoDaCampanha({ pathname: '/', hash: '', search: c === null ? '' : `?utm_campaign=${c}` }) === null,
     `campanha ${JSON.stringify(c)} → fica na home`);
}
ok(slugDaCampanha('aula-') === 'leilao-ao-vivo', 'o prefixo "aula-" basta');
ok(slugDaCampanha('AULA-09SET') === 'leilao-ao-vivo', 'a edição seguinte já cai na regra, sem mexer no código');
ok(slugDaCampanha('aula') === null, '"aula" sem hífen NÃO casa — o prefixo é literal');

console.log('\nSEM UTM NENHUM — visita orgânica na home não é tocada');
ok(destinoDaCampanha({ pathname: '/', hash: '', search: '' }) === null, 'home limpa fica home');
ok(destinoDaCampanha({ pathname: '/', hash: '', search: '?gclid=abc' }) === null, 'clique do Google sem campanha de aula fica na home');

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
