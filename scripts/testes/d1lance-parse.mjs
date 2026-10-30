// D1 LANCE (d1lance.com.br, 30/10) — páginas reais (sem <script>/<style>/<svg>):
//   lista-imoveis: `/navegar-pelo-mapa?tipo_filtro=imoveis` cortada nos 12 primeiros cards (o original tem 115 e ~1,6 MB);
//     tirados também os `wire:initial-data` e o `json_lotes_inicial` (cópias do acervo inteiro em JSON).
//   lote-<id>: <head> (title/og) + o componente Livewire `sidebar` da página do lote, que é onde o parser lê tudo
//     (a página inteira passa de 350 KB, quase tudo menu e cards de outros leilões).
//   2233: apartamento em Guarulhos, judicial, 2 praças (1ª = avaliação atualizada, 2ª = 50%), matrícula em PDF;
//   1697: apartamento em São Paulo, judicial, praça ÚNICA a 50% da avaliação atualizada (laudo R$ 1,61 mi → 1,82 mi);
//   2296: sala comercial em Mogi das Cruzes, extrajudicial — o 2º leilão (dívida) é MAIOR que o 1º, como o site publica;
//   2253: casa em Camaçari, Porto Bank (PARTICULAR), praça vencida em 27/10 e recebendo propostas → encerrado.
//   1581: casa no Jardim Santo Amaro (SP) com penhora de 50% — o bem vai INTEIRO à praça (art. 843), 2ª praça a 75%.
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, idDaUrl, totalDoCatalogo } from '../lib/d1lance-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/d1lance-${n}.html`, import.meta.url), 'utf8');
const B = 'https://d1lance.com.br/lote';
const U2233 = `${B}/agua-chata-guarulhossp/2233`;
const U1697 = `${B}/jardim-avelino-sao-paulosp/1697`;
const U2296 = `${B}/centro-mogi-das-cruzessp/2296`;
const U2253 = `${B}/loteamento-arembepe-aquaville-camacariba/2253`;
const U1581 = `${B}/jardim-santo-amaro-sao-paulosp/1581`;
const HOJE = new Date('2026-10-30T12:00:00-03:00');
const T = TENANTS.d1lance;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const lista = extrairUrlsDeLote(ler('lista-imoveis'));
eq('lista: 12 cards, url absoluta .com.br, id numérico', [lista.size, lista.get('2253'), idDaUrl(U2233)], [12, U2253, '2233']);
// O contador vem do JSON do Livewire (fora da fixture por tamanho): trecho no formato real do atributo.
const attr = (o) => `<div wire:initial-data="${JSON.stringify({ fingerprint: { name: 'listagem-de-leiloes' }, serverMemo: { data: o } }).replace(/"/g, '&quot;')}"></div>`;
eq('total declarado: página única = nº de lotes', totalDoCatalogo(attr({ lotes: [{}, {}, {}], lastPage: 1, currentPage: 1 })), 3);
eq('total declarado: há página seguinte = lista cortada', totalDoCatalogo(attr({ lotes: [{}, {}], lastPage: 3, currentPage: 1 })), 3);
eq('total declarado: sem o componente → null', totalDoCatalogo(ler('lista-imoveis')), null);

const d = parseDetalhe(ler('lote-2233'), U2233, { agora: HOJE });
const r = montarRow(U2233, d, T);
eq('2233 título = tipo + endereço + bairro + cidade', r.titulo, 'Apartamento - Avenida River, 465 - Água Chata - Guarulhos/SP');
eq('2233 cidade/UF do endereço do bem', [r.cidade, r.estado, r.tipo], ['Guarulhos', 'SP', 'apartamento']);
eq('2233 avaliação atualizada = 1ª praça; 2ª a 50%', [r.valor_avaliacao, r.valor_minimo, r.valor_minimo_2], [238950.08, 238950.08, 119475.04]);
eq('2233 praças 26/11 e 16/12 15h', [r.data_leilao, r.data_leilao_2], ['2026-11-26T15:00:00-03:00', '2026-12-16T15:00:00-03:00']);
eq('2233 judicial, aguardando = aberto', [r.modalidade, d.situacao, d.encerrado], ['judicial', 'AGUARDANDO_INICIO', false]);
eq('2233 matrícula nº e PDF', [r.numero_matricula, /matr%C3%ADcula\.pdf$/.test(r.link_matricula)], ['137.165', true]);
eq('2233 área privativa, foto de capa, edital', [r.area_m2, /lote_202610151632591\.webp$/.test(r.link_foto), r.link_edital], [40.32, true, 'https://d1lance.com.br/edital_do_leilao/2233']);
eq('2233 fração ideal do TERRENO não descarta o apartamento', checarQualidade(r, { estrito: false }).descartar, false);

const d2 = parseDetalhe(ler('lote-1697'), U1697, { agora: HOJE });
const r2 = montarRow(U1697, d2, T);
eq('1697 praça única a 50%', [r2.valor_avaliacao, r2.valor_minimo, r2.valor_minimo_2, r2.data_leilao, r2.data_leilao_2], [1826514.75, 913257.38, null, '2026-11-04T15:00:00-03:00', null]);
eq('1697 São Paulo, 156 m², em pregão', [r2.cidade, r2.area_m2, d2.situacao, d2.encerrado], ['São Paulo', 156, 'INICIADO', false]);
eq('1697 galeria', r2.fotos.length, 44);

const d3 = parseDetalhe(ler('lote-2296'), U2296, { agora: HOJE });
const r3 = montarRow(U2296, d3, T);
eq('2296 extrajudicial, sala em Mogi das Cruzes', [r3.modalidade, r3.tipo, r3.cidade, r3.titulo], ['extrajudicial', 'comercial', 'Mogi das Cruzes', 'Sala Comercial - Conj. 91 - Rua Santana, 335 - Centro - Mogi das Cruzes/SP']);
eq('2296 1º leilão = avaliação; 2º (dívida) maior, como o site publica', [r3.valor_avaliacao, r3.valor_minimo, r3.valor_minimo_2], [386970.56, 386970.56, 949259.62]);
eq('2296 datas 13/11 e 25/11', [r3.data_leilao, r3.data_leilao_2], ['2026-11-13T15:00:00-03:00', '2026-11-25T15:00:00-03:00']);
eq('2296 matrícula pelo PDF "mat.72883"', [r3.numero_matricula, r3.anexos.filter((a) => a.tipo === 'matricula').length], ['72.883', 1]);

const d4 = parseDetalhe(ler('lote-2253'), U2253, { agora: HOJE });
eq('2253 praça vencida (recebendo propostas) → encerrado', [d4.situacao, d4.encerrado, d4.cidade], ['RECEBENDO_PROPOSTAS', true, 'Camaçari']);

const d5 = parseDetalhe(ler('lote-1581'), U1581, { agora: HOJE });
const r5 = montarRow(U1581, d5, T);
eq('1581 penhora de 50% NÃO vira fração no título', [r5.titulo, checarQualidade(r5, { estrito: false }).descartar], ['Casa - Rua Darwin, 700 - Jardim Santo Amaro - São Paulo/SP', false]);
eq('1581 bem inteiro: 1ª praça já passou, corrente = 2ª a 75% da avaliação', [r5.valor_avaliacao, r5.valor_minimo, r5.valor_minimo_2, d5.encerrado], [3857547.29, 2893160.47, null, false]);

eq('encerrado pela situação', parseDetalhe(ler('lote-2233').replace(/AGUARDANDO_INICIO/g, 'SUSPENSO'), U2233, { agora: HOJE }).encerrado, true);
eq('encerrado depois da última praça', parseDetalhe(ler('lote-2233'), U2233, { agora: new Date('2026-12-17T00:00:00-03:00') }).encerrado, true);
eq('página sem o componente sidebar → null', parseDetalhe('<body>nada</body>', U2233), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ d1lance-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
