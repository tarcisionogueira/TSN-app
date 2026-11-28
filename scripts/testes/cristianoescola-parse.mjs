// CRISTIANO ESCOLA LEILÕES — site novo (Laravel + Inertia, 28/11). As páginas trazem os dados num
// <script data-page="app" type="application/json">; os trechos abaixo são cópias REAIS lidas pelo banco (pg_net) em 28/11,
// reduzidas ao que o parser usa (descrição cortada, 2 fotos):
//   catálogo /leiloes?page=1 (lote 4992 em 2ª praça, evento 3415 de boxes); lote 4992 (apto em Bento Gonçalves, 2ª praça,
//   sem "Valor de Avaliação" no texto); lote 5103 (terreno em Caxias, 1ª praça, matrícula e laudo); lote 5060
//   (armações de óculos, category "maquinas" — não é imóvel).
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, parseDetalhe, montarRow, idDaUrl, dadosDaPagina } from '../lib/cristianoescola-parse.mjs';

const pagina = (component, props) => `<!DOCTYPE html><html><head><title>Cristiano Escola Leilões</title></head><body>
<script data-page="app" type="application/json">${JSON.stringify({ component, props })}</script></body></html>`;
const HOJE = new Date('2026-11-28T10:00:00-03:00');
const T = TENANTS.cristianoescola;
const B = 'https://www.cristianoescolaleiloes.com.br';
const U4992 = `${B}/leiloes/leilao_de_apartamento_no_202_com_area_privativa_de_13965m_do_condominio_edificio_candido_portinari_em_bento_goncalvesrs/lotes/4992`;
const U5103 = `${B}/leiloes/leilao_terreno_urbano_com_area_de_70020m_no_bairro_interlagos_na_cidade_de_caxias_do_sulrs/lotes/5103`;
const U5060 = `${B}/leiloes/leilao_de_armacoes_de_oculos/lotes/5060`;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const catalogo = pagina('Auctions/Index', { items: { total: 203, per_page: 14, current_page: 1, last_page: 15, data: [
  { id: 3415, kind: 'auction', link: `${B}/leiloes/box_de_garagem`, title: 'BOX DE GARAGEM DO EDIFÍCIO SAINT MORITZ, BENTO GONÇALVES/RS',
    firstAuction: { date: '26/11/2026', time: '14:00' }, secondAuction: { date: '03/12/2026', time: '15:45' } },
  { id: 4992, kind: 'lot', link: U4992, title: 'APARTAMENTO Nº 202, COM ÁREA PRIVATIVA DE 139,65M², DO CONDOMÍNIO EDIFÍCIO CÂNDIDO PORTINARI, EM BENTO GONÇALVES/RS',
    activeRound: 2, firstAuction: { date: '05/11/2026', time: '16:03' }, secondAuction: { date: '03/12/2026', time: '14:55' }, suggestedValue: 'R$ 418.500,00' },
  { id: 5103, kind: 'lot', link: U5103, title: 'LOTE ÚNICO: TERRENO URBANO COM ÁREA DE 700,20M²…',
    firstAuction: { date: '03/12/2026', time: '16:20' }, secondAuction: { date: '10/12/2026', time: '14:05' } },
  { id: 5060, kind: 'lot', link: U5060, title: 'Armações de Óculos', firstAuction: { date: '30/11/2026', time: '14:00' }, secondAuction: null },
] } });

const lotes = extrairUrlsDeLote(catalogo);
eq('catálogo: só kind=lot vira lote', [...lotes.keys()], ['4992', '5103', '5060']);
eq('catálogo: kind=auction vira evento', [...extrairUrlsDeEvento(catalogo).entries()], [['3415', `${B}/leiloes/box_de_garagem`]]);
eq('id da url nova e da antiga', [idDaUrl(U4992), idDaUrl(`${B}/ver-lote/4976_UM-TERRENO`)], ['4992', '4976']);
eq('página que não é do app → sem dados', [dadosDaPagina('<html><title>Um momento, por favor…</title></html>'), extrairUrlsDeLote('<html></html>').size], [null, 0]);

const evento = pagina('Auctions/Show', { auction: { id: 3415 }, lots: [{ id: 5041, kind: 'lot', link: `${B}/leiloes/box_de_garagem/lotes/5041`,
  firstAuction: { date: '26/11/2026', time: '14:00' }, secondAuction: { date: '03/12/2026', time: '15:45' } }] });
eq('evento: props.lots vira lote', [...extrairUrlsDeLote(evento).keys()], ['5041']);

const lote4992 = pagina('Auctions/Lots/Show', { lot: { id: 4992, category: 'imoveis',
  title: 'APARTAMENTO Nº 202, COM ÁREA PRIVATIVA DE 139,65M², DO CONDOMÍNIO EDIFÍCIO CÂNDIDO PORTINARI, EM BENTO GONÇALVES/RS',
  endsAt: '2026-12-03T14:55:00-03:00', status: null, isClosed: false, modality: 'Simultâneo', roundLabel: 'Segundo leilão', auctionType: 'Leilão Judicial',
  documents: [], editalUrl: `${B}/storage/auction-documents/3387/edital-de-leilao-5002891-3420208210005.pdf`,
  media: [{ url: `${B}/storage/auction-items/4992/portinari2-1.webp`, type: 'image' }, { url: `${B}/storage/auction-item-gallery/4992/2-62.webp`, type: 'image' }],
  characteristics: [{ label: 'Tipo de imóvel', value: 'Apartamento' }, { label: 'Situação do imóvel', value: 'Não Informado' },
    { label: 'Localização do imóvel', value: 'Rua José Mario Mônaco, 177, Ap. 202 - Ed. Portinari, Centro, Bento Gonçalves/RS' }],
  description: '<p>LOTE ÚNICO: O APARTAMENTO Nº 202, COM ÁREA REAL PRIVATIVA DE 139,65M², DO CONDOMÍNIO EDIFÍCIO CÂNDIDO PORTINARI, SITO À RUA JOSÉ MÁRIO MÔNACO, NA CIDADE DE BENTO GONÇALVES/RS, com a seguinte descrição registral: “APARTAMENTO número DUZENTOS E DOIS (202)…</p>',
  currentBidCents: 41850000, initialPriceCents: 41850000 } });
const d = parseDetalhe(lote4992, U4992, { agora: HOJE });
const r = montarRow(U4992, d, T);
eq('4992: cidade da localização, imóvel', [r.cidade, r.estado, d.naoImovel], ['Bento Gonçalves', 'RS', false]);
eq('4992: as duas praças (catálogo), aberto', [r.data_leilao, r.data_leilao_2, d.encerrado], ['2026-11-05T16:03:00-03:00', '2026-12-03T14:55:00-03:00', false]);
eq('4992: 2ª praça sem "Valor de Avaliação" no texto → avaliação desconhecida, lance da praça', [r.valor_avaliacao, r.valor_minimo], [0, 418500]);
eq('4992: área, edital, foto e fonte_id da numeração antiga', [r.area_m2, r.link_edital, r.link_foto, r.fonte_id],
  [139.65, `${B}/storage/auction-documents/3387/edital-de-leilao-5002891-3420208210005.pdf`, `${B}/storage/auction-items/4992/portinari2-1.webp`, 'cristianoescola_4992']);
eq('4992: judicial', r.modalidade, 'judicial');

const lote5103 = pagina('Auctions/Lots/Show', { lot: { id: 5103, category: 'imoveis',
  title: 'LOTE ÚNICO: TERRENO URBANO COM ÁREA DE 700,20M², COM EDIFÍCIO RESIDENCIAL EM CONSTRUÇÃO, SITO AO BAIRRO INTERLAGOS, NA CIDADE DE CAXIAS DO SUL/RS,',
  endsAt: '2026-12-03T16:20:00-03:00', status: null, isClosed: false, modality: 'Simultâneo', roundLabel: 'Primeiro leilão', auctionType: 'Leilão Judicial',
  documents: [{ id: 2475, url: `${B}/storage/auction-item-documents/5103/380-matrimovel2.pdf`, label: 'Matrícula' },
    { id: 2476, url: `${B}/storage/auction-item-documents/5103/325-laudo1.pdf`, label: 'Avaliação' }],
  editalUrl: `${B}/storage/auction-documents/3438/edital-de-leilao-5055931-0820238210010.pdf`,
  media: [{ url: `${B}/storage/auction-items/5103/projeto-1.webp`, type: 'image' }],
  characteristics: [{ label: 'Tipo de imóvel', value: 'Terreno Urbano' }, { label: 'Localização do imóvel', value: 'Rua Demétrio Moreira da Luz, Loteamento Vila Nova, Bairro Interlagos, Caxias do Sul/RS' }],
  description: '<p>LOTE ÚNICO: TERRENO URBANO COM ÁREA DE 700,20M², … conforme a Av.4 da matrícula nº 19.225, do Registro de Imóveis da 1ª Zona de Caxias do Sul/RS…</p>',
  currentBidCents: 203983300, initialPriceCents: 203983300 } });
const d2 = parseDetalhe(lote5103, U5103, { agora: HOJE });
const r2 = montarRow(U5103, d2, T);
eq('5103: 1ª praça → lance inicial = avaliação', [r2.valor_avaliacao, r2.valor_minimo], [2039833, 2039833]);
eq('5103: praças, cidade, área', [r2.data_leilao, r2.data_leilao_2, r2.cidade, r2.area_m2], ['2026-12-03T16:20:00-03:00', '2026-12-10T14:05:00-03:00', 'Caxias do Sul', 700.2]);
eq('5103: matrícula e laudo nos anexos', [r2.link_matricula, d2.anexos.map((a) => a.tipo)],
  [`${B}/storage/auction-item-documents/5103/380-matrimovel2.pdf`, ['edital', 'matricula', 'laudo']]);
eq('5103: título sem "LOTE ÚNICO:" nem vírgula final', /^Terreno Urbano Com Área de 700,20m²/.test(r2.titulo) && !/,$/.test(r2.titulo), true);

const lote5060 = pagina('Auctions/Lots/Show', { lot: { id: 5060, category: 'maquinas', title: 'Armações de Óculos - TOTALIDADE DOS BENS DESCRITOS NOS LOTES 02 AO 16',
  endsAt: '2026-11-30T14:00:00-03:00', isClosed: false, modality: 'Online', roundLabel: 'Primeiro leilão', auctionType: 'Leilão Judicial',
  documents: [], media: [], characteristics: [{ label: 'Tipo', value: 'Outros' }], description: '<p>TOTALIDADE DOS BENS PENHORADOS</p>',
  initialPriceCents: 3797500 } });
eq('5060: category "maquinas" → não é imóvel', parseDetalhe(lote5060, U5060, { agora: HOJE }).naoImovel, true);

const fechado = pagina('Auctions/Lots/Show', { lot: { id: 1, category: 'imoveis', title: 'CASA', isClosed: true, endsAt: '2026-12-30T10:00:00-03:00', initialPriceCents: 100 } });
eq('isClosed → encerrado', parseDetalhe(fechado, `${B}/leiloes/x/lotes/1`, { agora: HOJE, pracas: new Map() }).encerrado, true);
eq('praça vencida → encerrado', parseDetalhe(pagina('Auctions/Lots/Show', { lot: { id: 2, category: 'imoveis', title: 'CASA', endsAt: '2026-11-01T10:00:00-03:00' } }),
  `${B}/leiloes/x/lotes/2`, { agora: HOJE, pracas: new Map() }).encerrado, true);
eq('página sem lot → null', parseDetalhe(catalogo, U4992), null);

console.log(`cristianoescola-parse: ${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
