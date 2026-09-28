// LG Corretor Judicial — contra HTML REAL capturado em 28/09 (fixtures/lgcorretor-*).
import fs from 'fs';
import { extrairImoveis, extrairDocumentos, montarRow } from '../lib/lgcorretor-parse.mjs';
import { ehFracaoIdeal } from '../lib/scraper-core.mjs';
const F = (n) => fs.readFileSync(new URL(`./fixtures/lgcorretor-${n}.html`, import.meta.url), 'utf8');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const busca = extrairImoveis(F('buscar-p1'));
eq('busca: 8 imóveis por página', busca.length, 8);
eq('home: 4 em destaque', extrairImoveis(F('home')).length, 4);
const jau = montarRow(busca.find((p) => p.code === 'LGCJ-22039'), []);
eq('Jaú: título', jau.titulo, 'Prédio Residencial em Vila Netinho Prado, Jaú - SP');
eq('Jaú: preço/área/CEP/UF', [jau.valor_minimo, jau.area_m2, jau.cep, jau.estado], [110000, 125, '17208020', 'SP']);
eq('Jaú: venda direta, sem data, avaliação desconhecida', [jau.modalidade, jau.data_leilao, jau.valor_avaliacao], ['venda_direta', null, 0]);
eq('Jaú: foto do blob público', /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/.+\.webp$/.test(jau.link_foto), true);
eq('Jaú: link do imóvel', jau.url_lote, 'https://www.lgcorretorjudicial.com.br/imovel/57f69e14-5ae4-40e2-a5c9-0628e1a6e66b');
// Descrição longa vem como referência "$<id>" para uma linha T do RSC — tem de ser resolvida.
eq('CEP ausente vira nulo (não 8 espaços)', montarRow(busca.find((p) => p.code === 'LGCJ-41295'), []).cep, null);
const tatui = busca.find((p) => p.code === 'LGCJ-59985');
eq('Tatuí: descrição resolvida da linha T', /Tatu[íi]/.test(tatui.description) && !/^\$/.test(tatui.description), true);
eq('Parte ideal: barrada pela regra de fração', ehFracaoIdeal(montarRow(tatui, [])), true);
eq('Casa inteira: não é fração', ehFracaoIdeal(jau), false);

const docs = extrairDocumentos(F('imovel'));
eq('documentos: 5 PDFs', docs.length, 5);
eq('documentos: tipos', docs.map((d) => d.tipo).sort(), ['edital', 'laudo', 'matricula', 'outro', 'outro']);
const comDocs = montarRow(busca.find((p) => p.code === 'LGCJ-22039'), docs);
eq('edital vira link_edital E regras de venda', [/Edital/.test(decodeURIComponent(comDocs.link_edital)), comDocs.link_regras_venda === comDocs.link_edital], [true, true]);
eq('matrícula', /Matr%C3%ADcula/.test(comDocs.link_matricula), true);

console.log(`${falhas ? '✗' : '✓'} lgcorretor-parse: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
