// MV LEILÕES (mvleiloes.com.br, 29/10) — três páginas reais de lote (sem <style>/<script>):
//   402: aberto — praças no topo ("1ª DATA 18/11/2026 14:00 Lance inicial R$225.000,00"), endereço sem cidade;
//   207: aberto — o edital cita "empresa … com sede em Niterói/RJ" (a parte), mas o bem fica em Pechincha (Capital/RJ);
//   403: encerrado — topo sem datas, que só vêm no texto do edital ("no dia 04/05/2026 … 2º leilão … dia 05/05/2026").
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, parseDetalhe, montarRow, pracas, textoDe } from '../lib/mvleiloes-parse.mjs';
const T = TENANTS.mv;
const ler = (n) => fs.readFileSync(new URL(`./fixtures/mvleiloes-lote-${n}.html`, import.meta.url), 'utf8');
const U = (s) => `https://mvleiloes.com.br/leilao_imoveis/${s}/`;
const U402 = U('apto-402-rua-edgard-werneck-710-freguesia-jacarepagua');
const U207 = U('apto-207-bloco-4-rua-mirataia-350-pechincha-jacarepagua');
const U403 = U('apartamento-403-engenho-da-rainha');
const HOJE = new Date('2026-10-29T12:00:00-03:00');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const home = '<a href="https://mvleiloes.com.br/leilao_imoveis/apto-102-rocha-miranda/">a</a><a href="https://mvleiloes.com.br/leilao_imoveis/apto-102-rocha-miranda/">b</a>'
  + '<a href="https://mvleiloes.com.br/como-participar/">c</a>';
eq('home: lote único por slug, só leilao_imoveis', [...extrairUrlsDeLote(home).entries()], [['apto-102-rocha-miranda', 'https://mvleiloes.com.br/leilao_imoveis/apto-102-rocha-miranda/']]);

// 402 — aberto
const d = parseDetalhe(ler('402'), U402, { agora: HOJE });
const r = montarRow(U402, d, T);
eq('402 praças do topo', [r.data_leilao, r.data_leilao_2, r.valor_minimo, r.valor_minimo_2], ['2026-11-18T14:00:00-03:00', '2026-11-19T14:00:00-03:00', 225000, 112500]);
eq('402 cidade pelo cartório/comarca da Capital', [r.cidade, r.estado], ['Rio de Janeiro', 'RJ']);
eq('402 aberto e judicial', [d.encerrado, r.modalidade], [false, 'judicial']);
eq('402 matrícula do bem (não a do leiloeiro, 0149)', r.numero_matricula, '195.321');
eq('402 edital em PDF e foto sem variante redimensionada', [/\.pdf$/.test(r.link_edital), /-\d+x\d+\.jpe?g$/.test(r.link_foto || 'x-1x1.jpg')], [true, false]);
eq('402 fonte_id pelo slug', r.fonte_id, 'mvleiloes_apto-402-rua-edgard-werneck-710-freguesia-jacarepagua');

// 207 — a cidade da PARTE no edital não vira a cidade do bem
const r207 = montarRow(U207, parseDetalhe(ler('207'), U207, { agora: HOJE }), T);
eq('207 Pechincha é Rio de Janeiro, não Niterói', [r207.cidade, r207.estado], ['Rio de Janeiro', 'RJ']);
eq('207 matrícula', r207.numero_matricula, '265.924');

// 403 — encerrado, datas só no edital
const d403 = parseDetalhe(ler('403'), U403, { agora: HOJE });
eq('403 datas do edital', [d403.data_leilao, d403.data_leilao_2], ['2026-05-04T14:00:00-03:00', '2026-05-05T14:00:00-03:00']);
eq('403 encerrado', d403.encerrado, true);
eq('403 entre as praças, vale a 2ª', parseDetalhe(ler('403'), U403, { agora: new Date('2026-05-04T18:00:00-03:00') }).data_leilao, '2026-05-05T14:00:00-03:00');

// Sem data nenhuma não entra (não dá para saber se está aberto).
eq('sem praça → null', parseDetalhe('<title>Terreno – Maicon &amp; Valéria Kahn</title><body>Lance inicial R$6.650.000,00 Endereço X O Imóvel Y</body>', U('t')), null);
eq('pracas: topo tem prioridade', pracas(textoDe('1ª DATA 10/11/2026 14:30 Lance inicial R$15.000.000,00 60% 2ª DATA 16/11/2026 14:30 Lance inicial R$12.500.000,00'))[2], { data: '2026-11-16T14:30:00-03:00', valor: 12500000 });

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ mvleiloes-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
