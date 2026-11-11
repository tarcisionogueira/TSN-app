// KLÖCKNER LEILÕES (kleiloes.com.br, 11/11, pendência 468) — front Next.js novo sobre o backend da Suporte.
// Fixtures: HTML real de 11/11 — catálogo de imóveis (página 1), lote 57942 (imóvel judicial, Campo Mourão/PR, 2 praças,
// edital + matrícula em PDF) e lote 56579 (moto em venda direta, Cianorte/PR).
import fs from 'fs';
import { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, TENANTS, area, pracasDe } from '../lib/kleiloes-parse.mjs';

let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const ler = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const B = TENANTS.kleiloes.base;
const AGORA = new Date('2026-11-11T12:00:00-03:00');

// 1. Catálogo
const urls = extrairUrlsDeLote(ler('kleiloes-catalogo-imoveis.html'), B);
eq('catálogo: 24 lotes na página', urls.size, 24);
eq('url com o slug do site', urls.get('57951'), 'https://www.kleiloes.com.br/lote/57951-imovel-maringa-pr');
eq('id da url', idDaUrl('https://www.kleiloes.com.br/lote/57942-imovel-campo-mourao-pr'), '57942');
eq('link sem slug ainda vira url', [...extrairUrlsDeLote('<a href="/lote/57846">x</a>', B).values()], ['https://www.kleiloes.com.br/lote/57846']);

// 2. Imóvel judicial com 2 praças
const u = 'https://www.kleiloes.com.br/lote/57942-imovel-campo-mourao-pr';
const d = parseDetalhe(ler('kleiloes-lote-imovel.html'), u, { agora: AGORA });
eq('id', d.id, '57942');
eq('título', d.titulo, 'Imóvel - Campo Mourão/PR');
eq('cidade e UF do painel', [d.cidade, d.estado], ['Campo Mourão', 'PR']);
eq('avaliação e lance da 1ª praça', [d.valor_avaliacao, d.valor_minimo], [493000, 246500]);
eq('2ª praça com o mesmo valor não vira valor_minimo_2', d.valor_minimo_2, null);
eq('data da praça vigente (1ª, 18/11)', d.data_leilao, '2026-11-18');
eq('2ª praça (02/12 16h de Brasília)', d.data_leilao_2, '2026-12-02T19:00:00.000Z');
eq('modalidade e tipo', [d.modalidade, d.tipo], ['judicial', 'comercial']);
eq('área e matrícula da ficha', [d.area_m2, d.numero_matricula], [437.5, '20.960']);
eq('processo', d.numero_processo, '5003603-75.2014.4.04.7010');
eq('edital e matrícula em PDF', [d.anexos.map((a) => a.tipo), /\.pdf$/.test(d.link_edital), /\.pdf$/.test(d.link_matricula)], [['edital', 'matricula'], true, true]);
eq('fotos', [d.fotos.length, /^https:\/\/static\.suporteleiloes\.com\.br\/kleiloescombr\//.test(d.link_foto)], [2, true]);
eq('comitente', d.comitente, '1ª VARA DA JUSTIÇA FEDERAL DE CAMPO MOURÃO');
eq('aberto', [d.status, d.encerrado], ['Aberto para Lances', false]);
eq('descrição começa pelo texto do bem', /^Imóvel de matrícula nº 20\.960/.test(d.descricao), true);
const row = montarRow(u, d, TENANTS.kleiloes);
eq('fonte_id igual ao do site antigo (mesmo id de lote)', [row.fonte, row.fonte_id], ['KLEILOES', 'kleiloes_57942']);
eq('passa na qualidade', checarQualidade(row, { estrito: false }).ok, true);
eq('depois da 1ª praça, vale a 2ª', parseDetalhe(ler('kleiloes-lote-imovel.html'), u, { agora: new Date('2026-11-20T12:00:00-03:00') }).data_leilao, '2026-12-02');
eq('praças vencidas e não é venda direta → encerrado', parseDetalhe(ler('kleiloes-lote-imovel.html'), u, { agora: new Date('2026-12-05T12:00:00-03:00') }).encerrado, true);

// 3. Veículo em venda direta
const v = parseDetalhe(ler('kleiloes-lote-veiculo.html'), 'https://www.kleiloes.com.br/lote/56579-honda-biz-125-es-2007-2007', { agora: AGORA });
eq('veículo: modalidade e tipo do bem', [v.modalidade, v.tipo_bem, v.eh_imovel], ['venda_direta', 'Moto', false]);
eq('veículo: valor e data de encerramento', [v.valor_minimo, v.data_leilao], [7885, '2026-11-24']);
eq('veículo: cidade da descrição ("município: Cianorte/PR")', [v.cidade, v.estado], ['Cianorte', 'PR']);
eq('veículo: ficha na descrição (placa, chassi)', /placa: APA-8F89/.test(v.descricao) && /chassi/.test(v.descricao), true);
eq('veículo fora do acervo de imóveis', checarQualidade(montarRow('x', v, TENANTS.kleiloes), { estrito: false }).faltando, ['fora_do_acervo']);

// 4. Área digitada à mão
eq('área com vírgula', area('437,50m²'), 437.5);
eq('área com milhar e vírgula', area('20.360,00m²'), 20360);
eq('área com ponto decimal', area('41.14 m²'), 41.14);
eq('área com ponto de milhar', area('54.152 m²'), 54152);
eq('duas áreas: vale a 1ª', area('1.000,19m² e 2.001,81m²'), 1000.19);
eq('área implausível (< 10 m²) vira 0', area('2.54 m²'), 0);

// 5. Praças das linhas do painel
eq('praças ordenadas, sem avaliação nem incremento', pracasDe([
  { k: 'Avaliação', v: 'R$ 1,00', tipo: 'aval' }, { k: '2º Leilão', sub: '23/11/2026 10:00', v: 'R$ 1.171.709,53' },
  { k: '1º Leilão', sub: '16/11/2026 10:00', v: 'R$ 1.520.000,00' }, { k: 'Incremento', v: 'R$ 2.000,00' },
]).map((p) => [p.n, p.dia, p.valor]), [[1, '2026-11-16', 1520000], [2, '2026-11-23', 1171709.53]]);

console.log(`kleiloes-parse: ${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
