/**
 * scripts/testes/zuk-local-veiculo.mjs — 29/09. O 1º "X/YY" do card do ZUK é a marca/modelo
 * ("Honda/CB 300R" virava cidade "Honda" UF "CB"); o local mora no título entre hífens.
 * Títulos reais do acervo. Ver scripts/lib/zuk-local-veiculo.mjs.
 */
import { localVeiculoZuk } from '../lib/zuk-local-veiculo.mjs';

let falhas = 0;
const eq = (c, cidade, estado) => {
  const r = localVeiculoZuk(c);
  const ok = r.cidade === cidade && r.estado === estado;
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗'} ${cidade}/${estado}${ok ? '' : ` — veio ${r.cidade}/${r.estado}`}`);
};

console.log('\nlocal do veículo no PortalZuk');
eq({ title: 'Motos - Honda em leilão - Rua Cerejeira, 328 - Francisco Morato/SP - Tribunal de Justiça do Estado de São Paulo | Z36660', addr: 'Motocicleta, HONDA/CB 300R' }, 'Francisco Morato', 'SP');
eq({ title: "Veículos - VW em leilão - Rua Allan D'Ângelo, 33 - Bragança Paulista/SP - Tribunal de Justiça do Estado de São Paulo | Z37016" }, 'Bragança Paulista', 'SP');
eq({ title: 'Motos - Honda em leilão - Avenida Conselheiro Francisco de Paula Mayrink,, 352 - Mairinque/SP - Tribunal de Justiça | Z37044' }, 'Mairinque', 'SP');
eq({ title: 'sem local no título', addr: 'Carro, VW/Fusca 1300. Cachoeira Paulista/SP' }, 'Cachoeira Paulista', 'SP');
eq({ title: 'sem local', addr: 'Motocicleta, Honda/CG 150' }, null, null);

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
