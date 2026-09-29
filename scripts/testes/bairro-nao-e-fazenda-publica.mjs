/**
 * scripts/testes/bairro-nao-e-fazenda-publica.mjs — 29/09. `extrairEnderecoMatricula` aceitava
 * "fazenda X" como bairro (imóvel rural) e "Vara da Fazenda Pública" virava bairro: 29 lotes em 6
 * fontes; o mercadológico de São Carlos buscou casas no "bairro Fazenda Pública" e voltou vazio.
 */
import { extrairEnderecoMatricula } from '../../api/_registro-matricula.js';

let falhas = 0;
const eq = (txt, esperado) => {
  const b = extrairEnderecoMatricula(txt)?.bairro || null;
  const ok = b === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗'} ${JSON.stringify(txt).slice(0, 80)} → ${b}${ok ? '' : ` (esperado ${esperado})`}`);
};

console.log('\nbairro não é a Fazenda Pública');
eq('Imóvel residencial - São Carlos/SP · Judicial · Comitente: VARA DA FAZENDA PÚBLICA', null);
eq('Execução movida pela Fazenda Pública desta cidade contra o executado', null);
eq('Exequente: Fazenda Nacional. Imóvel na Rua X', null);
eq('Imóvel rural denominado Fazenda Boa Vista, nesta comarca', 'Fazenda Boa Vista');
eq('situado no bairro Jardim Paulista, medindo 10 m', 'Jardim Paulista');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
