// ALLIANCE (allianceleiloes.com.br, 28/10) — páginas reais: 4 cards da home (513 com praça futura; 424 "Participe" com
// praça de 2021; 485 venda direta sem data; 66 "Futuro" sem data e sem venda direta) e 3 lotes:
//   470-01 judicial, 1ª e 2ª praça, "neste Município e Comarca de São Vicente";
//   485-01 venda direta sem praça, "46º SUBDISTRITO VILA FORMOSA" (Capital);
//   510-01 venda direta, "R.I. Cotia".
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, cidadeDoLote } from '../lib/alliance-parse.mjs';
const T = TENANTS.alliance;
const ler = (n) => fs.readFileSync(new URL(`./fixtures/alliance-${n}.html`, import.meta.url), 'utf8');
const B = 'https://www.allianceleiloes.com.br';
const HOJE = new Date('2026-10-28T12:00:00-03:00');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const ev = extrairUrlsDeEvento(ler('home-cards'), B, { agora: HOJE });
eq('evento: praça futura e venda direta sem data entram; 2021 e "Futuro" sem data ficam fora', [...ev.keys()].sort(), ['485', '513']);
eq('lotes do leilão', [...extrairUrlsDeLote(ler('lote-470-01'), B).keys()], ['470-01']);

const u470 = `${B}/lotes/470-01-rua-benedito-calixto-21`;
const d470 = parseDetalhe(ler('lote-470-01'), u470, { agora: HOJE });
const r470 = montarRow(u470, d470, T);
eq('470 cidade pela Comarca', [r470.cidade, r470.estado], ['São Vicente', 'SP']);
eq('470 praças, avaliação', [r470.valor_avaliacao, r470.valor_minimo, r470.valor_minimo_2, r470.data_leilao, r470.data_leilao_2],
  [611055.45, 611055.45, 366633.27, '2026-11-05T12:00:00-03:00', '2026-11-30T12:00:00-03:00']);
eq('470 judicial, aberto', [r470.modalidade, d470.encerrado], ['judicial', false]);
eq('470 foto da galeria', /arquivos\/leiloes\/lotes\/imagens\/[0-9a-f]+\.JPG$/i.test(r470.link_foto), true);
eq('470 matrícula no texto (formato do helper comum)', r470.numero_matricula, '36.474');
eq('470 depois da 2ª praça, encerrado', parseDetalhe(ler('lote-470-01'), u470, { agora: new Date('2026-12-01T12:00:00-03:00') }).encerrado, true);
eq('470 entre as praças vale a 2ª', parseDetalhe(ler('lote-470-01'), u470, { agora: new Date('2026-11-10T12:00:00-03:00') }).valor_minimo, 366633.27);

const u485 = `${B}/lotes/485-01-rua-curuena-45-87-e-133`;
const d485 = parseDetalhe(ler('lote-485-01'), u485, { agora: HOJE });
eq('485 subdistrito numerado = São Paulo', [d485.cidade, d485.estado], ['São Paulo', 'SP']);
eq('485 venda direta sem praça, aberta, lance = avaliação', [d485.modalidade, d485.encerrado, d485.data_leilao, d485.valor_minimo], ['venda_direta', false, null, 450000]);

const u510 = `${B}/lotes/510-01-rua-sao-joao-732`;
eq('510 cidade do cartório (R.I. Cotia)', cidadeDoLote('Casa - Granja Viana', parseDetalhe(ler('lote-510-01'), u510, { agora: HOJE }).descricao).cidade, 'Cotia');

eq('bairro paulistano sem pista no texto fica sem cidade', cidadeDoLote('Apartamento - Tatuapé', 'Apartamento nº 43 na Rua Cantagalo').cidade, null);
eq('não-imóvel pelo título do leilão', parseDetalhe(ler('lote-470-01').replace('Apartamento - São Vicente</h2>', 'Veículo Honda Civic</h2>'), u470, { agora: HOJE }).naoImovel, true);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ alliance-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
