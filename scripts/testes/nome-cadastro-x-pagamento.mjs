// Régua de nome em dois níveis (11/11, decisão do dono): "pelo cadastro explorador a ideia é aceitar um
// nome ou nome completo. Já em pagamentos exigir nome completo."
// As duas cópias (front src/lib/nome.js e servidor api/_nome.js) precisam concordar.
import { validarNome, validarNomeCadastro } from '../../src/lib/nome.js';
import { erroNome, erroNomeCadastro } from '../../api/_nome.js';

let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const casos = [
  // [nome, aceito no cadastro grátis?, aceito no pagamento?]
  ['Maria', true, false],
  ['Ana', true, false],
  ['João', true, false],
  ['Maria da Silva', true, true],
  ['Ana C. Silva', true, true],
  ["D'Ávila Souza", true, true],
  ['J', false, false],
  ['', false, false],
  ['Joao123', false, false],
  ['Maria @', false, false],
  ['Medina Imoveis', false, false],
  ['Imobiliária', false, false],
];
for (const [n, cadastro, pagamento] of casos) {
  eq(`front cadastro "${n}"`, validarNomeCadastro(n).ok, cadastro);
  eq(`servidor cadastro "${n}"`, !erroNomeCadastro(n), cadastro);
  eq(`front pagamento "${n}"`, validarNome(n).ok, pagamento);
  eq(`servidor pagamento "${n}"`, !erroNome(n), pagamento);
}

console.log(`nome-cadastro-x-pagamento: ${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
