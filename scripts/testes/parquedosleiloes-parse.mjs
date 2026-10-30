// PARQUE DOS LEILÕES (parquedosleiloes.com.br, 30/10) — páginas reais (sem <script>/<style>):
//   lista-jud: `/leiloes-judiciais?searchMode=judicial&is_lot=1&type_id=3` (12 lotes de imóvel);
//   84817: aberto, 1ª praça, título genérico "IMÓVEL EDEIA/GO", laudo de avaliação em PDF, "Próximos Lotes" com OUTRO imóvel;
//   84579: encerrado, 2ª praça (avaliação desconhecida), sala comercial em Porto Alegre/RS;
//   84163: extrajudicial (BRB), "CASA GUARA/DF" com matrícula em PDF.
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, parseDetalhe, montarRow, loteJson, tipoDaDescricao } from '../lib/parquedosleiloes-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/parquedosleiloes-${n}.html`, import.meta.url), 'utf8');
const U = (ev, id) => `https://www.parquedosleiloes.com.br/leilao/${ev}/lote/${id}`;
const HOJE = new Date('2026-10-30T12:00:00-03:00');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const lista = extrairUrlsDeLote(ler('lista-jud'));
eq('lista: 12 lotes, id do lote → url absoluta', [lista.size, lista.get('84817')], [12, U(1520, 84817)]);

// 84817 — aberto, 1ª praça
const d = parseDetalhe(ler('lote-84817'), U(1520, 84817), { agora: HOJE });
const r = montarRow(U(1520, 84817), d, TENANTS.parque_jud);
eq('84817 título genérico vira tipo + cidade', r.titulo, 'Terreno em Edéia/GO');
eq('84817 cidade com acento (descrição antes do título)', [r.cidade, r.estado], ['Edéia', 'GO']);
eq('84817 lance e avaliação (1ª praça)', [r.valor_minimo, r.valor_avaliacao], [375000, 375000]);
eq('84817 encerra 23/11 15:20 de Brasília, aberto, judicial', [r.data_leilao, d.encerrado, r.modalidade], ['2026-11-23T15:20:00-03:00', false, 'judicial']);
eq('84817 matrícula do bem', r.numero_matricula, '4.064');
eq('84817 só a foto DESTE lote (Próximos Lotes fora)', d.fotos, ['https://www.parquedosleiloes.com.br/storage/properties/525/images/5b08b11aa04ddd186d2943b3f0e68526.webp']);
eq('84817 edital + laudo', r.anexos.map((a) => a.tipo), ['edital', 'laudo']);
eq('84817 descrição não traz o lote 04 da quadra 31 (próximo lote)', /quadra 31/.test(r.descricao), false);
eq('84817 fonte_id', r.fonte_id, 'parquedosleiloes_jud_84817');

// 84579 — 2ª praça encerrada
const d2 = parseDetalhe(ler('lote-84579'), U(1514, 84579), { agora: HOJE });
eq('84579 sala comercial em Porto Alegre', montarRow(U(1514, 84579), d2, TENANTS.parque_jud).titulo, 'Sala comercial em Porto Alegre/RS');
eq('84579 2ª praça: avaliação desconhecida, lance 50 mil, encerrado', [d2.valor_avaliacao, d2.valor_minimo, d2.encerrado], [0, 50000, true]);

// 84163 — extrajudicial, matrícula anexa
const d3 = parseDetalhe(ler('lote-84163'), U(1509, 84163), { agora: HOJE });
const r3 = montarRow(U(1509, 84163), d3, TENANTS.parque);
eq('84163 casa no Guará = Brasília/DF, extrajudicial', [r3.cidade, r3.estado, r3.modalidade], ['Brasília', 'DF', 'extrajudicial']);
eq('84163 matrícula em PDF vira link_matricula', /\/lote\/84163\/documento\/\d+$/.test(r3.link_matricula || ''), true);

// Bordas
eq('sem auctionLot → null', parseDetalhe('<title>X — Y</title><body>nada</body>', U(1, 2)), null);
eq('auctionLot com entidades', loteJson('<div data-json="auctionLot">{&quot;id&quot;:1,&quot;ended_at&quot;:&quot;2026-11-01 10:00:00&quot;}</div>'), { id: 1, ended_at: '2026-11-01 10:00:00' });
eq('tipo: sala antes de terreno', tipoDaDescricao('a sala 604 … fração ideal do terreno'), 'Sala comercial');

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ parquedosleiloes-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
