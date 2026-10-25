// Plataforma Leilovia (Casa de Leilões e RP Leilões, MS) — contra HTML REAL baixado pelo servidor do banco em 25/10
// (#356; o IIS só responde sem cabeçalho). Fixtures: scripts/testes/fixtures/leilovia-*.
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, cidadeDoTexto } from '../lib/leilovia-parse.mjs';
import { naoEhImovel } from '../lib/dom-parse-util.mjs';

const F = (n) => fs.readFileSync(new URL(`./fixtures/${n}.html`, import.meta.url), 'utf8');
const AGORA = new Date('2026-10-25T12:00:00-03:00');
const C = TENANTS.casadeleiloes;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

// ── Enumeração ──
const ev = extrairUrlsDeEvento(F('leilovia-casa-home'), C.base);
eq('home: leilão de veículo/sucata/DETRAN e o simulador fora', [...ev.keys()].sort(), ['14677', '14679', '14681', '14691', '14697', '14698', '14699', '14700', '14701', '14708']);
eq('home: URL do leilão', ev.get('14698'), 'https://www.casadeleiloes.com.br/leilao/4-vara-civel-de-dourados-ms/14698');
eq('RP: simulador fora, leilão de imóveis do município fica', [...extrairUrlsDeEvento(F('leilovia-rp-home'), TENANTS.rpleiloes.base).keys()], ['7']);
eq('comissão de bens apreendidos: sucata, "para circular" e suspenso nem são baixados',
  extrairUrlsDeLote(F('leilovia-casa-leilao-veiculos'), C.base).size, 0);

// ── Lote: casa em Glória de Dourados ──
const uC = 'https://www.casadeleiloes.com.br/lote/lote-01/imovel-urbano-lote-10-quadra-46-com-area-de-360-m2-situado-na-rua-joao-calado-da-silva-antiga-r/66967';
const c = montarRow(uC, parseDetalhe(F('leilovia-casa-lote-casa'), uC, { agora: AGORA }), C);
eq('casa: fonte_id', c.fonte_id, 'casadeleiloes_66967');
eq('casa: cidade do texto, conferida no IBGE para a UF do campo Local', [c.cidade, c.estado], ['Glória de Dourados', 'MS']);
eq('casa: avaliação do texto, lance inicial = mínimo (1ª praça)', [c.valor_avaliacao, c.valor_minimo], [85000, 85000]);
eq('casa: encerramento e 2ª praça', [c.data_leilao, c.data_leilao_2], ['2026-11-06T11:03:00-03:00', '2026-11-13T11:03:00-03:00']);
eq('casa: matrícula ("matrícula de n.º 8.449"), área, modalidade', [c.numero_matricula, c.area_m2, c.modalidade], ['8.449', 360, 'judicial']);
eq('casa: edital, matrícula, laudo e proposta nomeados', c.anexos.map((a) => a.tipo), ['edital', 'matricula', 'laudo', 'documento']);
eq('casa: pronto', !naoEhImovel(`${c.titulo} ${c.descricao}`, c.titulo) && !checarQualidade(c, { estrito: false }).descartar, true);

// ── Lote: terreno em Corumbá (2º leilão; avaliação TOTAL, não a do terreno sozinho) ──
const uT = 'https://www.casadeleiloes.com.br/lote/lote-001/lote-de-terreno-de-n-10-da-rua-ciriaco-de-toledo-da-quadra-a-do-loteamento-sincor-com-um-total-d/66809';
const t = montarRow(uT, parseDetalhe(F('leilovia-casa-lote-terreno'), uT, { agora: AGORA }), C);
eq('terreno: título', t.titulo, 'Terreno - Corumbá/MS');
eq('terreno: "Valor da Avaliação Total" ganha dos parciais', [t.valor_avaliacao, t.valor_minimo, t.data_leilao_2], [250000, 150000, null]);
eq('terreno: matrícula', t.numero_matricula, '21.937');

// ── Lote: veículo num leilão de vara cível ──
const uV = 'https://www.casadeleiloes.com.br/lote/lote-01/ford-courier-l-1-6-flex-placa-njl-3926-conforme-fls-457-461/66968';
eq('veículo: não é imóvel (as regras do edital citam "Bens Imóveis" e "Casa de Leilões")', parseDetalhe(F('leilovia-casa-lote-veiculo'), uV, { agora: AGORA }).naoImovel, true);
eq('cidadeDoTexto: cidade de outra UF não vale', cidadeDoTexto('situado na cidade de Campinas/SP', 'MS'), { cidade: null, estado: 'MS' });

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ leilovia: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
