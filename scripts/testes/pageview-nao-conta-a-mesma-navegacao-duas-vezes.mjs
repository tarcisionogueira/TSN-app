/**
 * scripts/testes/pageview-nao-conta-a-mesma-navegacao-duas-vezes.mjs
 *
 * POR QUE EXISTE (01/09). O app usa `HashRouter`: navegar chama `history.pushState` (que o
 * tracker patcheia) E muda o hash, o que faz o navegador emitir `hashchange` (que o tracker
 * escuta). Uma navegação, dois pageviews. Medido em 3 dias: `/` e `/live/<slug>` com 47% de
 * duplicata, `/login` 31%, e as páginas de SEO (`/leiloes/*`) com 0% — 494 duplicatas em 4.793.
 *
 * O QUE ESTE TESTE SEGURA, e é o risco de qualquer trava de repetição: **matar navegação
 * legítima**. Voltar para uma rota depois de sair dela é evento real e precisa continuar
 * contando; o que não pode contar duas vezes é a MESMA navegação. Um dedup rígido demais
 * transformaria um bug de inflação num bug de subcontagem — que é pior, porque some.
 *
 * A régua é reproduzida aqui (o tracker depende de `window`/`document` e não importa fora do
 * navegador), então este teste exercita a REGRA, não a implementação. Se a janela mudar no
 * tracker, mude aqui junto — e o comentário de lá diz de onde o número veio.
 */
const JANELA_PV_MS = 1000;

function criarRegua() {
  let ultima = { rota: null, em: 0 };
  return (rota, agora) => {
    if (rota === ultima.rota && agora - ultima.em < JANELA_PV_MS) return false;
    ultima = { rota, em: agora };
    return true;
  };
}

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\nA DUPLICATA DA MESMA NAVEGAÇÃO É DESCARTADA');
{
  const conta = criarRegua();
  // Os dois disparos reais de uma navegação: pushState e, 29 ms depois, hashchange.
  ok(conta('/live/leilao-ao-vivo', 1000) === true,  'pushState registra');
  ok(conta('/live/leilao-ao-vivo', 1029) === false, 'hashchange 29 ms depois NÃO registra');
}
{
  const conta = criarRegua();
  ok(conta('/', 0) === true, 'carga inicial registra');
  ok(conta('/', 40) === false, 'o eco de 40 ms não registra');
  ok(conta('/', 999) === false, 'ainda dentro da janela, não registra');
  ok(conta('/', 1000) === true, 'passada a janela, volta a registrar');
}

console.log('\nNAVEGAÇÃO LEGÍTIMA CONTINUA CONTANDO — a trava não pode virar mordaça');
{
  const conta = criarRegua();
  ok(conta('/buscar', 0) === true,        'entra na busca');
  ok(conta('/imovel/abc', 300) === true,  'abre um imóvel 300 ms depois (rota DIFERENTE)');
  ok(conta('/buscar', 600) === true,      'volta para a busca — rota mudou no meio, conta');
}
{
  const conta = criarRegua();
  ok(conta('/leiloes', 0) === true,     'página de SEO');
  ok(conta('/leiloes', 3000) === true,  're-visita 3 s depois conta (os pares de 1–5 s são gente)');
}
{
  // O caso que o dono vive: abrir a mesma aula duas vezes na mesma sessão, com minutos de
  // intervalo. Se isso deixasse de contar, o funil da aula passaria a subnotificar.
  const conta = criarRegua();
  ok(conta('/live/leilao-ao-vivo', 0) === true,       'primeira visita à aula');
  ok(conta('/live/leilao-ao-vivo', 120000) === true,  'volta 2 min depois — conta');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
