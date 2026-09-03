/**
 * npm run testar:uf-edital — "duas letras" não é um estado.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO (03/09), encontrado ao apurar se dava para depender menos de leiloeiro.
 *
 * O Radar de Editais validava a UF do imóvel com `/^[A-Za-z]{2}$/` — conferia o FORMATO e
 * chamava isso de UF. Passaram **89 editais com estado impossível**, todos fragmentos que a
 * regex de "Cidade/UF" mordeu do texto do edital:
 *
 *     ME (41) · CR (31) · AN (6) · CG (2) · LA · LO · DO · CL · AI · DI · CB · MF · VW
 *
 * É a forma nº 8 do CLAUDE.md em estado puro: casar um formato não é validar o conteúdo.
 * Enquanto o radar era só de SP isso era ruído no fundo da tabela. Ao abrir `RADAR_TRIBUNAIS`
 * para o Brasil, `imovel_uf` vira O filtro por estado — e filtro sujo é pior que filtro
 * nenhum, porque ele RESPONDE.
 *
 * O SEGUNDO DEFEITO, no mesmo campo e pior: o insert gravava `p.imovel_uf || 'SP'`. Com o
 * radar restrito a TJSP/TRT15 o default era invisível e até plausível. Aberto para o país,
 * todo edital do TJBA ou do TJMG cujo parse não achasse a UF entraria como **São Paulo** —
 * dado inventado com cara de dado, e num campo que decide o que o cliente vê.
 */
import { ufValida, ufDoTribunal } from '../../api/radar-editais-cron.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nAS 27 UFs PASSAM — todas, sem exceção');
const TODAS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
checa('as 27 são aceitas', TODAS.every((u) => ufValida(u) === u), TODAS.filter((u) => ufValida(u) !== u));
checa('são 27, não 26 nem 28 — DF entra, e é o que costuma faltar', TODAS.length === 27 && ufValida('DF') === 'DF');
checa('minúscula normaliza', ufValida('sp') === 'SP');
checa('com espaço normaliza', ufValida('  rj ') === 'RJ');

console.log('\nO LIXO REAL QUE ESTAVA GRAVADO — os 13 valores medidos no banco');
// Não são exemplos inventados: é a lista exata que a consulta devolveu, com as contagens.
for (const [v, n] of [['ME', 41], ['CR', 31], ['AN', 6], ['CG', 2], ['LA', 1], ['LO', 1],
                      ['DO', 1], ['CL', 1], ['AI', 1], ['DI', 1], ['CB', 1], ['MF', 1], ['VW', 1]]) {
  checa(`"${v}" (${n} edita${n > 1 ? 'is' : 'l'}) vira null`, ufValida(v) === null, ufValida(v));
}
// A régua ANTIGA aprovaria os 13 — é isso que prova que o teste mede a mudança, e não o óbvio.
checa('a régua antiga /^[A-Za-z]{2}$/ aprovaria TODOS os 13',
  ['ME','CR','AN','CG','LA','LO','DO','CL','AI','DI','CB','MF','VW'].every((v) => /^[A-Za-z]{2}$/.test(v)));

console.log('\nO VAZIO É NULL, NUNCA UM ESTADO');
checa('null → null', ufValida(null) === null);
checa('vazio → null', ufValida('') === null);
checa('uma letra → null', ufValida('S') === null);
checa('três letras → null', ufValida('SPO') === null);
checa('número → null', ufValida('12') === null);

console.log('\nA UF DO TRIBUNAL — deduz do TJ, e admite não saber');
checa('TJSP → SP', ufDoTribunal('TJSP') === 'SP');
checa('TJBA → BA', ufDoTribunal('TJBA') === 'BA');
checa('TJDFT → DF', ufDoTribunal('TJDFT') === 'DF', ufDoTribunal('TJDFT'));
// TRT e TRF cobrem várias UFs: chutar uma seria inventar. Nulo é a resposta certa.
checa('TRT15 → null (o TRT-15 cobre o interior de SP, não é uma UF)', ufDoTribunal('TRT15') === null, ufDoTribunal('TRT15'));
checa('TRF3 → null (cobre SP e MS)', ufDoTribunal('TRF3') === null, ufDoTribunal('TRF3'));
checa('sigla desconhecida → null', ufDoTribunal('XYZ') === null);
checa('vazio → null', ufDoTribunal('') === null);

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
// Piso: um import que resolvesse sem as funções deixaria tudo "passar" com zero verificações.
if (ok + falhas < 28) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
