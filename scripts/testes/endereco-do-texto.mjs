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
// Esquina: as duas ruas são do lote — fica a primeira (a 2ª vem depois de "esquina", é ignorada).
eq('Terreno situado na Rua Batista de Carvalho, esquina com a Avenida Rodrigues Alves', 'Bauru', 'endereco', 'Rua Batista de Carvalho');
eq('Terreno na Rua Tiradentes, 50 e também na Avenida Paulista, 900', 'Bauru', 'motivo', 'varios_logradouros');
eq('Terreno na Rua 7 de Setembro, 88', 'Bauru', 'endereco', 'Rua 7 de Setembro, 88');
eq('Terreno com 300 m² no centro', 'Bauru', 'motivo', 'sem_logradouro');

// Leituras erradas do 1º seco (29/09) — anúncio, não matrícula:
eq('Terreno na Rua João Pans em trecho plano e estruturado do condomínio', 'Minaçu', 'endereco', 'Rua João Pans');
eq('Terreno em avenida com pavimentação em calçamento', 'Iraí', 'motivo', 'sem_logradouro');
eq('Terreno na Rua Dr. Mário Silva, 45 - Centro', 'Campos Altos', 'endereco', 'Rua Dr. Mário Silva, 45');
eq('Terreno - Rua Projetada F, lote 3', 'Pitangui', 'motivo', 'sem_logradouro');
eq('TERRENO NA RUA EDSON DE LIMA, 230 - CENTRO', 'Borda da Mata', 'endereco', 'Rua EDSON DE LIMA, 230');
eq('Terreno na Rua Itaquaquecetuba, 900, confrontando pelos fundos com a Rua Vicente Leporace', 'Ferraz de Vasconcelos', 'endereco', 'Rua Itaquaquecetuba, 900');
eq('Terreno com 300 m² na Avenida Brasil 300 m² de frente', 'Maringá', 'endereco', 'Avenida Brasil');

// 2º seco (29/09):
eq('Terreno na Avenida São Paulo, 88', 'Barbosa Ferraz', 'endereco', 'Avenida São Paulo, 88');
eq('Terreno às margens da Rodovia SC-157 Inscrição imobiliária 123', 'São Lourenço do Oeste', 'endereco', 'Rodovia SC-157');
eq('Imóvel rural na Estrada do Po', 'Umbaúba', 'motivo', 'sem_logradouro');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
