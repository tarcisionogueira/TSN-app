// Teste do endereço da PESTANA pela observação (#88). Casos reais do acervo de 08/10.
import { enderecoObsPestana } from '../lib/pestana-endereco.mjs';

let ok = 0, falhou = 0;
const caso = (nome, obs, esperado) => {
  const r = enderecoObsPestana(obs);
  const bate = JSON.stringify(r) === JSON.stringify(esperado);
  if (bate) ok++; else { falhou++; console.log(`✗ ${nome}\n  esperado ${JSON.stringify(esperado)}\n  veio     ${JSON.stringify(r)}`); }
};

caso('rodovia sn com bairro', 'Gramado/RS. Bairro Várzea a Grande (in loco). Rodovia RS 115, sn (in loco). Terreno com área superficial de 33.274,00m². Matrícula 18.808 do RI local.',
  { logradouro: 'Rodovia RS 115, s/n', bairro: 'Várzea a Grande' });
caso('rua com número e sala', 'Porto Alegre/RS. Centro Histórico (in loco). Rua Demétrio Ribeiro, 990. Sala 302. Edifício Anna Carolina. Áreas: privativa 42,70m².',
  { logradouro: 'Rua Demétrio Ribeiro, 990', bairro: 'Centro Histórico' });
caso('loteamento com lote e quadra', 'Nova Petrópolis /RS. Loteamento Bosque das Araucárias – Etapa I. Rua Bosque das Coníferes, sn (Lote 32 da Quadra 02). Terreno com área superficial de 378,00m².',
  { logradouro: 'Rua Bosque das Coníferes, s/n (Lote 32 da Quadra 02)', bairro: 'Loteamento Bosque das Araucárias – Etapa I' });
caso('avenida', 'Divinópolis do Tocantins/TO. Loteamento Central. Avenida Tancredo Neves, sn (Lote 06 da Quadra 55). Prédio.',
  { logradouro: 'Avenida Tancredo Neves, s/n (Lote 06 da Quadra 55)', bairro: 'Loteamento Central' });
caso('acesso', 'Santa Cruz do Sul/RS. Bairro Jardim Europa (in loco). Acesso Grasel, sn. Terreno com área superficial de 28.647,85m².',
  { logradouro: 'Acesso Grasel, s/n', bairro: 'Jardim Europa' });
caso('texto de ônus sem endereço não inventa', 'Regularizações e encargos perante os órgãos competentes, correrão por conta do(a) comprador(a). A responsabilidade de eventual levantamento topográfico.', null);
caso('matrícula descritiva antiga não inventa', 'Um terreno, situado no Loteamento denominado LOTEAMENTO RURAL ELDORADO, no alinhamento da Estrada nº 2, lado ímpar.', null);
caso('vazio', '', null);

console.log(`${falhou ? '✗' : '✓'} ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
