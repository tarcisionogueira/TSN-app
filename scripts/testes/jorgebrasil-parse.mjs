// JORGE BRASIL (jorgebrasil.lel.br, 30/10) — página real (sem <script>/<style>):
//   home: a agenda inteira — 15 imóveis em tabela, sem página de lote (praças 03/11–10/11 e 11/12–18/12, sem ano).
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, detalhesDoCatalogo, montarRow, checarQualidade, idDaUrl } from '../lib/jorgebrasil-parse.mjs';
const html = fs.readFileSync(new URL('./fixtures/jorgebrasil-home.html', import.meta.url), 'utf8');
const HOJE = new Date('2026-10-30T12:00:00-03:00');
const T = TENANTS.jorgebrasil;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const urls = extrairUrlsDeLote(html);
const dets = detalhesDoCatalogo(html, T.base, { agora: HOJE });
eq('agenda: 15 imóveis, id = nome do PDF do edital', [urls.size, dets.size, urls.get('guada304')], [15, 15, 'https://www.jorgebrasil.lel.br/?item=guada304']);
eq('idDaUrl', idDaUrl(urls.get('spartacus')), 'spartacus');
const row = (id) => { const u = urls.get(id); return montarRow(u, dets.get(u), T); };

const g = row('guada304');
eq('Guadalupe: título até a 1ª cláusula, "P.A." = Porto Alegre', [g.titulo, g.cidade, g.estado], ['Apartamento 304, do Cond. Ed. Guadalupe, À Rua José de Alencar, 186 - Porto Alegre/RS', 'Porto Alegre', 'RS']);
eq('Guadalupe: avaliação = 1º lance, praças 03/11 e 10/11 às 11h (ano do "Atualizado em")',
  [g.valor_avaliacao, g.valor_minimo, g.data_leilao, g.data_leilao_2], [290257.73, 290257.73, '2026-11-03T11:00:00-03:00', '2026-11-10T11:00:00-03:00']);
eq('Guadalupe: matrícula, área, edital, foto, judicial', [g.numero_matricula, g.area_m2, g.link_edital, g.link_foto, g.modalidade, g.tipo],
  ['39.031', 71.13, 'https://www.jorgebrasil.lel.br/2026/guada304.pdf', 'https://www.jorgebrasil.lel.br/2026/guadalupe.jpeg', 'judicial', 'apartamento']);

const s = row('spartacus');
eq('Spartacus: avaliado 440 mil, 1º lance 420 mil (coluna de praças)', [s.valor_avaliacao, s.valor_minimo], [440000, 420000]);
const b = row('bav204');
eq('Alto da Baviera 204: Canoas/RS, 3 fotos', [b.cidade, dets.get(urls.get('bav204')).fotos.length], ['Canoas', 3]);
eq('Leopoldina: cidade só no nome da linha (São Leopoldo), sem foto ("_")', [row('leopoldina').cidade, row('leopoldina').link_foto], ['São Leopoldo', null]);
eq('Dom Alonso: sem cidade no texto → Porto Alegre (edital confirma)', row('alonsonovo').cidade, 'Porto Alegre');
eq('Paineiras: "18/12/26" com ano curto', row('colpaineiras').data_leilao_2, '2026-12-18T11:00:00-03:00');
eq('Rosário: conjunto = sala comercial', [row('rosario2109').tipo, row('rosario2109').titulo.startsWith('Sala comercial - Conjunto 2109')], ['comercial', true]);
eq('Akinita: "Poa/RS" vira Porto Alegre, terreno 490,05 m²', [row('akinita').titulo, row('akinita').area_m2], ['Terreno Av. Protásio Alves 4587, Porto Alegre/RS', 490.05]);
eq('Uarumã: box de garagem sai pelo filtro de negócio', checarQualidade(row('uarumamat2885'), { estrito: false }).descartar, true);
eq('Torre Perimetral: loja, edital com espaço no nome', [row('torreperimetral-copy').tipo, row('torreperimetral-copy').link_edital], ['comercial', 'https://www.jorgebrasil.lel.br/2026/TORREPERIMETRAL%20copy.pdf']);
eq('nenhum encerrado em 30/10', [...dets.values()].filter((d) => d.encerrado).length, 0);

// Depois da 1ª praça: vale a 2ª (data e lance).
const depois = detalhesDoCatalogo(html, T.base, { agora: new Date('2026-11-05T12:00:00-03:00') }).get(urls.get('guada304'));
eq('após 03/11: data e lance da 2ª praça', [depois.data_leilao, depois.valor_minimo, depois.data_leilao_2, depois.encerrado], ['2026-11-10T11:00:00-03:00', 145128.86, null, false]);
eq('após 10/11: encerrado', detalhesDoCatalogo(html, T.base, { agora: new Date('2026-11-11T12:00:00-03:00') }).get(urls.get('guada304')).encerrado, true);
// Agenda de dezembro listando janeiro: data sem ano > 60 dias antes da atualização é do ano seguinte.
const virada = html.replace('Atualizado em 27/10/2026', 'Atualizado em 20/12/2026').replace('1º Leilão: 03/11', '1º Leilão: 15/01');
eq('virada de ano: 15/01 com agenda de 20/12/2026 = 2027', detalhesDoCatalogo(virada, T.base, { agora: HOJE }).get(urls.get('guada304')).data_leilao, '2027-01-15T11:00:00-03:00');
eq('página sem agenda → nada', detalhesDoCatalogo('<html><body>nada</body></html>').size, 0);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ jorgebrasil-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
