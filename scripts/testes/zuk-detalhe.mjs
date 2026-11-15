// ZUK — card a partir da página do lote (15/11): coletar os lotes do mapa que a lista de cards não traz.
import assert from 'node:assert/strict';
import { cardDoDetalheZuk } from '../lib/zuk-detalhe.mjs';

const canon = 'https://www.portalzuk.com.br/imovel/pr/curitiba/mossungue/rua-paulo-gorski-2165/38212-239033';
const tituloPagina = 'Leilão de Apartamento Duplex - Mossunguê - Curitiba/PR cod: 239033 | Zuk';
// Texto real (recon 24/09, zuk-pracas.mjs) + o "Em leilão pelo valor de" do HTML cru de 15/11.
const texto = 'Imóvel ocupado Em leilão pelo valor de R$ 1.812.000,00 Lance mínimo: 1º Leilão 16/09/26 às 11h10 R$ 752.000,00 '
  + '2º Leilão 18/09/26 às 11h10 40 R$ 451.200,00 Valor de avaliação R$ 1.900.000,00 Comissão do leiloeiro 5% R$ 37.600,00';
const c = cardDoDetalheZuk({ canonical: canon, tituloPagina, ogImage: 'https://imagens.portalzuk.com.br/x.jpg', texto });
assert.equal(c.href, canon);
assert.equal(c.title, 'Apartamento Duplex - Mossunguê - Curitiba/PR');
assert.equal(c.tipo, 'Apartamento Duplex');
assert.equal(c.ocup, 'Imóvel ocupado');
assert.equal(c.img, 'https://imagens.portalzuk.com.br/x.jpg');
assert.ok(c.valores.includes('R$ 451.200,00') && c.valores.includes('R$ 1.900.000,00'), 'praças e avaliação');
assert.ok(!c.valores.includes('R$ 37.600,00'), 'comissão (R$ solto) não entra');

// Judicial: o comitente vai no title (o mapeamento decide a modalidade por ele).
const j = cardDoDetalheZuk({ canonical: canon, tituloPagina, texto: 'Comitente Tribunal de Justiça do Estado de São Paulo. Leilão Único 10/12/26 às 10h00 R$ 300.000,00' });
assert.match(j.title, /Tribunal de Justiça do Estado de São Paulo$/);
assert.deepEqual(j.valores, ['R$ 300.000,00']);

// Sem URL canônica (casca, erro) ou sem valor do lote → null, nunca card vazio.
assert.equal(cardDoDetalheZuk({ canonical: 'https://www.portalzuk.com.br/', tituloPagina, texto }), null);
assert.equal(cardDoDetalheZuk({ canonical: canon, tituloPagina, texto: 'Comissão R$ 37.600,00' }), null);
assert.equal(cardDoDetalheZuk(), null);
console.log('zuk-detalhe: ok');
