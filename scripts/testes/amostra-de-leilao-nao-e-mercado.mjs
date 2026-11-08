// Dono, 08/11: o relatório projeta por quanto o imóvel será vendido; anúncio de leilão não pode entrar na conta.
// Caso real ac777832 (Presidente Prudente): portais repetiam o apartamento da Caixa como amostra do nível 1.
import assert from 'node:assert/strict';
import { avaliarMercado, ehAmostraDeLeilao, ehAutoReferencia, limparComentarioDeLeilao } from '../../api/_valor-mercado.js';

const lote = { valorMinimo: 90074.38, valorAvaliacao: 160000, area: 39.3, cidade: 'Presidente Prudente', endereco: 'Rua Erminio Terim, N. 900, Apto 401, Bl 4' };

const repasses = [
  { fonte: 'Imovelweb', valor: 94815.14, m2: 39.3, valorM2: 2412.6, endereco: 'Rua Ermínio Terim, 900 - Apto 401, Bl 4', descricao: 'Apartamento em Vila Ramos de Freitas. Avaliado em R$ 160.000,00.' },
  { fonte: 'Wimoveis', valor: 94815, m2: 39.3, valorM2: 2412.6, endereco: 'Rua Ermínio Terim, 900 - Apto 401, Bl 4', descricao: 'Apartamento em Vila Ramos de Freitas.' },
  { fonte: 'Wimoveis', valor: 92444, m2: 39.3, valorM2: 2352.26, endereco: 'Rua Ermínio Terim, 900 - Apto 401, Bl 4', descricao: 'Apartamento em Vila Ramos de Freitas.' },
  { fonte: 'Loft', valor: 96592.92, m2: 39.3, valorM2: 2457.83, endereco: 'Rua Ermínio Terim, Vila Ramos de Freitas', descricao: 'Apartamento em Vila Ramos de Freitas.' },
];
for (const a of repasses) assert.equal(ehAutoReferencia(a, lote), true, `${a.fonte} ${a.valor}`);

const mercado = [
  { fonte: 'Imóvel web', valor: 135000, m2: 39, valorM2: 3461.54 },
  { fonte: 'ImobiBrasil', valor: 170000, m2: 48, valorM2: 3541.67 },
  { fonte: 'ZAP Imóveis', valor: 206269, m2: 39, valorM2: 5288.95 },
  { fonte: 'Loft', valor: 170000, m2: 39, valorM2: 4358.97 },
  { fonte: 'Imóvel web', valor: 169900, m2: 39, valorM2: 4356.41 },
];
for (const a of mercado) assert.equal(ehAutoReferencia(a, lote), false, `${a.fonte} ${a.valor}`);

const avaliacao = avaliarMercado({ nivel1: repasses, nivel2: mercado, nivel3: [], lote, minAmostras: 3 });
assert.equal(avaliacao.consolidado.n, 5, 'só os anúncios de mercado sustentam o valor');
console.log(`R$/m² sem o leilão: ${avaliacao.consolidado.precoMedioM2}`);
assert.ok(avaliacao.consolidado.precoMedioM2 > 3400, `R$/m² sem o leilão: ${avaliacao.consolidado.precoMedioM2}`);

// Se declara leilão em qualquer campo.
assert.equal(ehAmostraDeLeilao({ fonte: 'Sellar', descricao: 'Terreno em leilão (DESCONSIDERADO)' }), true);
assert.equal(ehAmostraDeLeilao({ fonte: 'Gaenzo', url: 'https://www.gaenzo.com.br/imovel/casa-tambore-2-venda-direta-leilao-2924' }), true);
assert.equal(ehAmostraDeLeilao({ fonte: 'LeilaoImovel / CEF' }), true);
assert.equal(ehAmostraDeLeilao({ fonte: 'Portal', ehLeilao: true }), true);
assert.equal(ehAmostraDeLeilao('Imóveis de Leilão Caixa'), true);

// Anúncio normal não cai por vocabulário parecido.
assert.equal(ehAmostraDeLeilao({ fonte: 'ZAP', descricao: 'Aceita financiamento pela Caixa Econômica.' }), false);
assert.equal(ehAmostraDeLeilao({ fonte: 'ZAP', descricao: 'Venda direta com o proprietário.' }), false);
assert.equal(ehAmostraDeLeilao({ fonte: 'ZAP', descricao: 'Não é leilão, escritura em dia.' }), false);

// Outro apartamento do mesmo prédio é o melhor comparável: fica.
const vizinho = { fonte: 'Loft', valor: 150000, m2: 39.3, valorM2: 3816, endereco: 'Rua Ermínio Terim, 900 - Apto 302, Bl 4' };
assert.equal(ehAutoReferencia(vizinho, lote), false);
assert.equal(ehAutoReferencia({ ...vizinho, endereco: 'Rua Ermínio Terim, 900' }, lote), false);
// Preço redondo na mesma metragem também fica.
assert.equal(ehAutoReferencia({ fonte: 'Viva Real', valor: 120000, m2: 39.3, valorM2: 3053 }, lote), false);

const comentario = "As amostras do Nível 1 apresentaram valores baixos por serem anúncios de 'Venda Online' ou 'Leilão Caixa Econômica Federal', o que contamina a média. O padrão do imóvel é considerado popular. Devido à presença de anúncios de leilão, a média foi ponderada.";
assert.equal(limparComentarioDeLeilao(comentario), 'O padrão do imóvel é considerado popular.');
const semLeilao = 'Região com boa oferta de comércio. O padrão é popular.';
assert.equal(limparComentarioDeLeilao(semLeilao), semLeilao);
console.log('ok: amostra de leilão não entra na conta de mercado');
