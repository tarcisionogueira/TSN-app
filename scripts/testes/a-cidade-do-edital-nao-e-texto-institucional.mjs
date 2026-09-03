/**
 * npm run testar:cidade-edital — a cidade de um lote não pode ser "Detran" nem "TRATANDO".
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Achado ao ensaiar a promoção "edital vira lote" (03/09, pedido do dono): entre as
 * "cidades" dos 87 editais elegíveis para virar lote estavam Detran, IBAPE, OAB, INTIME,
 * TRATANDO, "Justiça do Estado de São Paulo TJ", "Portal de Auxiliares da Justiça do TJ",
 * "Tabela Prática do TJ", "Vistos. CADASTRE", "SECRETARIA CONJUNTA DE ARARAQUARA",
 * "DIVISÃO DE EXECUÇÃO DE CAMPINAS" — todos trechos REAIS do banco.
 *
 * A causa é a mesma regex que acha "Cidade/UF" no texto do edital (`cidadeUf`) mordendo
 * texto institucional que só PARECE esse formato na superfície — a mesma família de
 * defeito do nome do leiloeiro (`NOME_BLOQ`), só que aqui o dano é maior: uma cidade
 * inventada não fica só no banco, ela vira um LOTE na vitrine, com endereço que não
 * existe em lugar nenhum. Sem este teste, a promoção criaria "imóveis" em Detran/SP.
 *
 * O SEGUNDO ACHADO, no mesmo lote de dados: cidades reais estavam sendo REJEITADAS por
 * carregarem um prefixo institucional ("Município de Mogi das Cruzes", "Imóveis de Santa
 * Cruz do Rio Pardo") — a MESMA cidade que aparecia limpa em outra menção do mesmo edital.
 * Descartar por causa do prefixo perdia uma cidade real; `CIDADE_PREFIXO` recupera.
 */
import { cidadeValida } from '../../api/radar-editais-cron.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nO LIXO REAL — os 12 valores medidos no banco em 03/09, todos devem virar null');
for (const ruim of [
  'Detran', 'IBAPE', 'OAB', 'OAB R', 'INTIME', 'TRATANDO',
  'Justiça do Estado de São Paulo TJ', 'Portal de Auxiliares da Justiça do TJ',
  'Tabela Prática do TJ', 'Vistos. CADASTRE', 'DIVISÃO DE EXECUÇÃO DE CAMPINAS',
  'SECRETARIA CONJUNTA DE ARARAQUARA',
]) checa(`"${ruim}" → null`, cidadeValida(ruim) === null, cidadeValida(ruim));

console.log('\nCIDADES REAIS — continuam passando (a régua não ficou larga demais)');
for (const boa of ['Araçatuba', 'Guarulhos', 'Jundiaí', 'São Paulo', 'São Vicente',
  'Santa Cruz do Rio Pardo', 'Bragança Paulista', 'Presidente Prudente'])
  checa(`"${boa}" passa`, cidadeValida(boa) === boa, cidadeValida(boa));

console.log('\nO PREFIXO INSTITUCIONAL É REMOVIDO, NÃO DESCARTA A CIDADE');
checa('"Município de Mogi das Cruzes" → "Mogi das Cruzes"',
  cidadeValida('Município de Mogi das Cruzes') === 'Mogi das Cruzes', cidadeValida('Município de Mogi das Cruzes'));
checa('"Imóveis de Santa Cruz do Rio Pardo" → "Santa Cruz do Rio Pardo"',
  cidadeValida('Imóveis de Santa Cruz do Rio Pardo') === 'Santa Cruz do Rio Pardo', cidadeValida('Imóveis de Santa Cruz do Rio Pardo'));
checa('"Comarca de Suzano" → "Suzano"',
  cidadeValida('Comarca de Suzano') === 'Suzano', cidadeValida('Comarca de Suzano'));
// As duas formas da MESMA cidade (com e sem prefixo) precisam convergir pro mesmo valor —
// senão o dedup por cidade (editais_dedup_candidato) trata "Mogi das Cruzes" e "Município de
// Mogi das Cruzes" como lugares diferentes.
checa('prefixado e limpo convergem pro mesmo valor',
  cidadeValida('Município de Suzano') === cidadeValida('Suzano'));

console.log('\nENTRADA VAZIA OU CURTA DEMAIS');
checa('vazio → null', cidadeValida('') === null);
checa('null → null', cidadeValida(null) === null);
checa('duas letras → null', cidadeValida('SP') === null);
checa('só número → null', cidadeValida('12345') === null);

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 27) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
