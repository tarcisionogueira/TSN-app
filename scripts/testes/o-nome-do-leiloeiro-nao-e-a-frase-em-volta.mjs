/**
 * npm run testar:leiloeiro — o nome do leiloeiro não é a frase em volta dele.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TODOS os casos abaixo são TRECHOS REAIS de `editais_leilao.texto_integral`, colhidos em
 * 03/09 agrupando os 78 caracteres em volta da palavra "leiloeir" nos editais que ficaram sem
 * nome. Nenhum foi inventado — é essa a diferença entre um teste que mede a mudança e um que
 * confirma o que o autor já achava.
 *
 * ── O TAMANHO REAL DO PROBLEMA, e por que "75% sem nome" media outra coisa ───────────────
 * 356 dos 477 editais estavam sem leiloeiro. Mas:
 *   • 192 (54%) o texto NEM CITA "leiloeiro" — não há o que extrair. Não é falha de parse.
 *   •  36      são `nao_edital` (o filtro duro já os descartou de propósito).
 *   • 128      ALVO REAL: editais de verdade em que o texto cita o leiloeiro e o parse falhou.
 * Contar nulos misturava "o parser errou" com "o edital não nomeia ninguém" — duas coisas que
 * se parecem numa contagem e pedem ações opostas (forma nº 10 do CLAUDE.md).
 *
 * ── POR QUE A REGEX ÚNICA QUEBRAVA ──────────────────────────────────────────────────────
 * Ela tentava acertar preâmbulo, nome e terminador numa expressão só:
 *   /leiloeir[ao]\s*(?:oficial|público)?\s*[:\-]?\s*(NOME)(?:,|\.|\s+JUCESP|…)/
 * Quatro formas reais a derrubavam: o `(o)` de "Leiloeira(o)", o "nomeada(o)" no meio, o
 * hífen antes do JUCESP (`- JUCESP` não casa com `\s+JUCESP`), e o parêntese/aspa. Trocada
 * por preâmbulo → janela → validador: uma responsabilidade cada.
 *
 * ⚠️ E O DEFEITO QUE ESTE ARQUIVO PEGOU NA PRIMEIRA RODADA: a versão nova esqueceu a
 * exigência de INICIAL MAIÚSCULA. O comentário do código já dizia que ela era o guard — mas
 * `nomeLeiloeiroValido` nunca a teve (ele confere tamanho, nº de palavras, dígitos e
 * `NOME_BLOQ`, e só então capitaliza); quem exigia era a regex antiga. Sem o guard, o teste
 * devolveu quatro frases com cara de nome próprio, porque `tituloNome` capitaliza no fim:
 * "Perante Este Tribunal", "Informou A Ocorrência de Lance Vencedor", "Sobre A Manutenção do
 * Certame Designado", "Informou O Recebimento de Cinco Propostas". É o pior tipo de defeito
 * possível aqui — a saída é plausível, e passaria numa revisão de código.
 */
import { extrairLeiloeiro } from '../../api/radar-editais-cron.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};
const eq = (texto, esperado, rotulo) => {
  const r = extrairLeiloeiro(texto) || null;
  checa(rotulo, r === esperado, { obtido: r, esperado });
};

console.log('\nACHA O NOME — as quatro formas que a regex antiga perdia');
// 11 ocorrências no acervo: o maior bloco isolado. O `(o)` e o `nomeada(o)` quebravam.
eq('Leiloeira(o) Oficial nomeada(o) MARCOS ROBERTO TORRES, endereço eletrônico',
   'Marcos Roberto Torres', '"Leiloeira(o) Oficial nomeada(o) NOME," (11 editais)');
// O terminador era `\s+JUCESP`; aqui vem `- JUCESP`, e `-` não entrava na classe do nome.
eq('leiloeiro Gilson Keniti Inumaru - JUCESP nº 762/2007, sendo que',
   'Gilson Keniti Inumaru', 'hífen antes do JUCESP');
eq('Leiloeiro: VICTOR ALBERTO SEVERINO FRAZÃO - Endereço Eletrônico: http',
   'Victor Alberto Severino Frazão', 'hífen antes de "Endereço"');
eq('leiloeiro(a) CASSIA NEGRETE NUNES BALBINO, devidamente credenciado(a)',
   'Cassia Negrete Nunes Balbino', '"leiloeiro(a) NOME,"');

console.log('\nACHA O NOME — parêntese, aspa e o nome citado só na SEGUNDA menção');
eq('leiloeira pública oficial Renata Franklin Simões (JUCESP nº 1.040), cuja habi',
   'Renata Franklin Simões', 'parêntese como terminador');
eq('leiloeira oficial "Hugo Alexandre Pedro Além - Jucesp 935 (www.vegasleiloes.c',
   'Hugo Alexandre Pedro Além', 'aspa antes do nome');
eq('leiloeiro ADRIANO ROGÉRIO DA SILVA LOPES (e-mail: adrianoleiloeirooficial@gma',
   'Adriano Rogério da Silva Lopes', 'e-mail como terminador');
// A PRIMEIRA menção é só a função; o nome vem na segunda. Parar na primeira devolvia a frase.
eq('leiloeiro. Para a realização do leilão, nomeio leiloeiro oficial o(a) Sr(a) Dora Plat, JUCESP',
   'Dora Plat', 'segunda menção — a primeira é só a função');

console.log('\nNÃO INVENTA NOME — o texto cita a FUNÇÃO, não a pessoa');
// Estes são a maioria dos trechos distintos: o edital fala do leiloeiro sem nomeá-lo. Devolver
// qualquer coisa aqui seria pior que devolver nada — um nome errado casa com o acervo errado.
for (const [t, rotulo] of [
  ['leiloeiro oficial credenciado perante este Tribunal, devendo a Serventia inti', 'credenciado perante este Tribunal'],
  ['leiloeiro a ser nomeado por este juízo. Em caso negativo, tornem conclusos', 'a ser nomeado por este juízo'],
  ['leiloeiro (art. 883, do CPC) para a expropriação de bens em sede de processo', 'citação de artigo do CPC'],
  ['leiloeiro de fls. 283/284. O preço foi depositado no prazo legal', 'referência a folhas'],
  ['Leiloeira informou o recebimento de cinco propostas de pagamento parcelado', 'verbo depois da função'],
  ['leiloeiro público oficial informou a ocorrência de lance vencedor no primeiro', 'verbo depois de dois qualificadores'],
  ['Leiloeira Oficial sobre a manutenção do certame designado para o dia 20/07/20', 'preposição depois da função'],
  ['leiloeira oficial às fls. 702/721, relativa ao imóvel objeto da matrícula', 'crase depois da função'],
  ['leiloeiro, devidamente identificados, a providenciar o cadastro e agendamento', 'vírgula imediata'],
  ['Leiloeiro - Trata-se de fase de cumprimento de sentença na qual foram penhor', 'hífen e verbo'],
  ['leiloeiro. Preferência: Ficam os condôminos cientes de que detêm preferência', 'ponto imediato'],
  ['leiloeiro oficial em R$ 9.700,00 (5% do acordo). Por força de disposição', 'valor em vez de nome'],
]) eq(t, null, `"${rotulo}" → null`);

console.log('\nO GUARD DA INICIAL MAIÚSCULA — o que a primeira versão esqueceu');
// Sem ele, `tituloNome` capitaliza a frase e o lixo SAI parecendo nome próprio. Estes quatro
// são exatamente os que passaram antes do conserto.
checa('nenhum dos 4 falsos positivos volta',
  ['leiloeiro oficial credenciado perante este Tribunal, devendo',
   'Leiloeira informou o recebimento de cinco propostas',
   'leiloeiro público oficial informou a ocorrência de lance vencedor',
   'Leiloeira Oficial sobre a manutenção do certame designado'].every((t) => extrairLeiloeiro(t) === null));
// E a prova de que o guard não é redundante com o NOME_BLOQ: "Perante Este Tribunal" não tem
// nenhuma das palavras bloqueadas — só a minúscula inicial o barra.
checa('"perante este Tribunal" só é barrado pela minúscula, não pelo NOME_BLOQ',
  extrairLeiloeiro('leiloeiro oficial credenciado perante este Tribunal,') === null
  && extrairLeiloeiro('leiloeiro oficial credenciado Perante Este Tribunal,') !== null);

console.log('\nENTRADA VAZIA OU SEM A PALAVRA');
eq('', null, 'texto vazio');
eq(null, null, 'null');
eq('Edital de praça pública de imóvel na comarca de Santos', null, 'texto sem a palavra "leiloeiro"');

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
// Piso: um import que resolvesse sem a função deixaria tudo "passar" com zero verificações.
if (ok + falhas < 25) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
