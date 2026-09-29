/**
 * scripts/testes/galeria-veiculo.mjs — 29/09. Galeria completa do veículo a partir da página do
 * lote (scripts/lib/galeria-veiculo.mjs). As URLs abaixo são as que o HTML REAL de um lote de cada
 * fonte continha (pg_net, 29/09) — inclusive as fotos de OUTROS lotes que a página mostra.
 */
import { galeriaDoHtml, montarFotos, fotosPreservadas, ehFotoPlaceholder } from '../lib/galeria-veiculo.mjs';

let falhas = 0;
const ok = (c, oque) => { if (c) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };
const html = (urls) => urls.map((u) => `<img src="${u}">`).join('\n');

console.log('\ngaleria do veículo');
const mega = html([
  'https://cdn1.megaleiloes.com.br/bank_icons/leilao-megaleiloes.png',
  'https://cdn1.megaleiloes.com.br/batches/127774/181b0610c27bea0e52e6bb47937d57d6_320x240.jpg',
  'https://cdn1.megaleiloes.com.br/batches/127799/b411d80a1e3f73c5722c758307c342aa_1024x768.jpg',
  'https://cdn1.megaleiloes.com.br/batches/127799/b411d80a1e3f73c5722c758307c342aa_320x240.jpg',
  'https://cdn1.megaleiloes.com.br/batches/127799/b411d80a1e3f73c5722c758307c342aa_670x380.jpg',
  'https://cdn1.megaleiloes.com.br/batches/127799/e8857a1d805ebcca4ada3b2b6821bd43_1024x768.jpg',
  'https://cdn1.megaleiloes.com.br/batches/127799/e8857a1d805ebcca4ada3b2b6821bd43_670x380.jpg',
  'https://cdn1.megaleiloes.com.br/batches/127801/81e279117e6aaff23020fc37f79428f4_320x240.jpg',
]);
const capaMega = 'https://cdn1.megaleiloes.com.br/batches/127799/b411d80a1e3f73c5722c758307c342aa_320x240.jpg';
let g = galeriaDoHtml('MEGA', mega, { capa: capaMega });
ok(g.length === 2 && g.every((u) => u.includes('/127799/') && u.endsWith('_1024x768.jpg')), `MEGA: 2 fotos do lote, na maior resolução, sem os outros lotes → ${g.length}`);
ok(montarFotos(capaMega, g).length === 2, 'MEGA: a capa (mesma foto em 320x240) não duplica');
ok(galeriaDoHtml('MEGA', mega, { idLote: '127799' }).length === 2, 'MEGA: sem capa, o id do lote ancora a galeria');

const zuk = html([
  'https://cdn.portalzuk.com.br/assets/images/logo-zuk-1200x650.png',
  'https://imagens.portalzuk.com.br/detalhe/2026/08/2246ca0d164ecdf5fa9c267ea805aaa4.jpg',
  'https://imagens.portalzuk.com.br/detalhe/2026/08/45c10e7b777f1655a9115bb8e28a9a5c.jpg',
  'https://imagens.portalzuk.com.br/detalhe/2026/08/9c4d46da1ffd1af3e63151f9b34cb7dc.jpg',
  'https://imagens.portalzuk.com.br/detalhe/2026/08/bc376b53214215f2a4e0337963abb03e.jpg',
  'https://imagens.portalzuk.com.br/mini/2026/09/18335e862088ce3ba8f20de0dad375e3.jpg',
]);
g = galeriaDoHtml('ZUK', zuk);
ok(g.length === 4 && g.every((u) => u.includes('/detalhe/')), `ZUK: 4 fotos de /detalhe/, sem as /mini/ dos outros lotes → ${g.length}`);
ok(montarFotos('https://imagens.portalzuk.com.br/mini/2026/08/45c10e7b777f1655a9115bb8e28a9a5c.webp', g).length === 4, 'ZUK: capa /mini/ .webp é a mesma foto da galeria — não duplica');
ok(galeriaDoHtml('ZUK', html(['https://imagens.portalzuk.com.br/mini/ImgNaoDispTerreno.jpg'])).length === 0, 'ZUK: lote sem foto não herda foto de ninguém');

const sup = html([
  'https://static.suporteleiloes.com.br/serpaleiloescombr/arquivos-avulsos/1/file-68fa192cb09b9-68fa192cb18e8.jpg',
  'https://static.suporteleiloes.com.br/serpaleiloescombr/bens/7204/arquivos/6aa2088dbafca-6aa2088de4628.jpg',
  'https://static.suporteleiloes.com.br/serpaleiloescombr/bens/7204/arquivos/6aa208935427d-6aa20893b4bc7.jpg',
  'https://static.suporteleiloes.com.br/serpaleiloescombr/bens/7204/arquivos/6aa20896571a5-6aa20896bd00e.jpg',
  'https://static.suporteleiloes.com.br/serpaleiloescombr/bens/9999/arquivos/outro-lote.jpg',
  'https://static.suporteleiloes.com.br/serpaleiloescombr/comitentes/sl-c-199-6aa2194312e7b-6aa2194313229.jpg',
]);
const capaSup = 'https://static.suporteleiloes.com.br/serpaleiloescombr/bens/7204/arquivos/6aa2088e6889c-6aa2088e78011.jpg';
g = galeriaDoHtml('SUPORTE', sup, { capa: capaSup });
ok(g.length === 3 && g.every((u) => u.includes('/bens/7204/')), `SUPORTE: 3 fotos do bem 7204, sem logo/comitente/outro bem → ${g.length}`);
ok(montarFotos(capaSup, g)[0] === capaSup && montarFotos(capaSup, g).length === 4, 'SUPORTE: capa diferente das fotos da galeria entra primeiro');
ok(galeriaDoHtml('SUPORTE', sup).length === 3, 'SUPORTE: sem capa, a pasta de bem mais frequente');

ok(ehFotoPlaceholder('https://www.megaleiloes.com.br/images/card-no-image-320x240.png') && ehFotoPlaceholder('https://imagens.portalzuk.com.br/mini/ImgNaoDispAuto.webp'), 'placeholder de "sem imagem" é reconhecido');
ok(montarFotos('https://www.megaleiloes.com.br/images/card-no-image-320x240.png', []).length === 0, 'capa placeholder não vira foto');
ok(galeriaDoHtml('OUTRA', mega).length === 0, 'fonte sem regra não inventa galeria');

const tres = ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg'];
ok(fotosPreservadas(['https://a/1.jpg'], tres).length === 3, 'galeria não encolhe quando a rodada só trouxe a capa');
ok(fotosPreservadas(['https://a/1.jpg', 'https://a/9.jpg'], tres).length === 2, 'galeria relida hoje (2+) vale, mesmo menor');
ok(fotosPreservadas(['https://x/card-no-image.png'], null).length === 0, 'placeholder sai mesmo sem anterior');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
