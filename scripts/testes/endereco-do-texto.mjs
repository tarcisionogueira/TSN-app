/**
 * scripts/testes/endereco-do-texto.mjs — 29/09. Endereço do lote a partir do texto, para tirar o
 * pino do centro da cidade (passo 3 do plano de localização). Ver scripts/lib/endereco-do-texto.mjs.
 */
import { enderecoDoTexto } from '../lib/endereco-do-texto.mjs';

let falhas = 0;
const eq = (txt, cidade, campo, esperado) => {
  const r = enderecoDoTexto(txt, cidade);
  const v = r[campo] ?? r.motivo ?? null;
  const ok = v === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗'} ${JSON.stringify(txt).slice(0, 70)} → ${campo}=${v}${ok ? '' : ` (esperado ${esperado})`}`);
};

console.log('\nendereço do texto');
eq('Terreno situado na Rua das Flores, nº 120, Jardim Primavera, CEP 13560-000, município de São Carlos', 'São Carlos', 'endereco', 'Rua das Flores, 120');
eq('Terreno situado na Rua das Flores, nº 120, CEP 13560-000, município de São Carlos', 'São Carlos', 'cep', '13560000');
eq('Lote localizado na Estrada Municipal do Pinhal, zona rural', 'Itu', 'endereco', 'Estrada Municipal do Pinhal');
eq('Terreno situado na Rua Antônio Prado, município de Campinas', 'Sumaré', 'motivo', 'outro_municipio');
eq('Terreno. Visitação no escritório do leiloeiro, localizado na Rua Augusta, 100', 'São Paulo', 'motivo', 'endereco_do_leiloeiro');
eq('Terreno situado na Rua Batista de Carvalho, esquina com a Avenida Rodrigues Alves', 'Bauru', 'motivo', 'varios_logradouros');
eq('Terreno com 300 m² no centro', 'Bauru', 'motivo', 'sem_logradouro');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
