// LEILÕES BRASIL TO (leiloesbrasilto.com.br, 30/10) — páginas reais (sem <script>/<style>):
//   imoveis: `/imoveis` (1 imóvel, link do LEILÃO 487); leilao-487: TRT10, 01/12/2026 11:00, bem 6420 em Palmas/TO;
//   bem-6420: popup do bem (processo CNJ, sem endereço); galeria-6420: "Não há fotos"; leilao-483: Araguaína, 19/08/2026
//   "- FINALIZADO", fração ideal de 25%.
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, idDaUrl } from '../lib/leiloesbrasilto-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/leiloesbrasilto-${n}.html`, import.meta.url), 'utf8');
const HOJE = new Date('2026-10-30T12:00:00-03:00');
const T = TENANTS.leiloesbrasilto;
// fetchFonte de mentira: serve o popup e a galeria a partir das fixtures; o resto "não abre".
const fetchFonte = async (u) => {
  const m = u.match(/\/(bem|bem_galeria)\/(\d+)$/);
  const n = m && `${m[1] === 'bem' ? 'bem' : 'galeria'}-${m[2]}`;
  return n && fs.existsSync(new URL(`./fixtures/leiloesbrasilto-${n}.html`, import.meta.url)) ? { html: ler(n), via: 'direto' } : { html: null, via: 'direto-404' };
};
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

eq('/imoveis → evento 487 (o link é do leilão)', [...extrairUrlsDeEvento(ler('imoveis')).values()], ['https://leiloesbrasilto.com.br/leilao/487']);
eq('/imoveis não traz bem direto', extrairUrlsDeLote(ler('imoveis')).size, 0);
const lotes = extrairUrlsDeLote(ler('leilao-487'));
const U = 'https://leiloesbrasilto.com.br/leilao/487#bem-6420';
eq('leilão 487 → bem 6420 no fragmento', [[...lotes.values()], idDaUrl(U)], [[U], '6420']);

const d = await parseDetalhe(ler('leilao-487'), U, { fetchFonte, agora: HOJE });
const r = montarRow(U, d, T);
eq('6420 título', r.titulo, 'Imóvel Urbano - Quadra 1003 Sul Arso 101, Alameda 12, Lote 04-A - Palmas/TO');
eq('6420 Palmas/TO', [r.cidade, r.estado], ['Palmas', 'TO']);
eq('6420 avaliado = lance = 400 mil, 01/12 11h', [r.valor_avaliacao, r.valor_minimo, r.data_leilao], [400000, 400000, '2026-12-01T11:00:00-03:00']);
eq('6420 aberto, judicial (TRT10), matrícula 104.572', [d.encerrado, r.modalidade, r.numero_matricula], [false, 'judicial', '104.572']);
eq('6420 edital do leilão, sem foto, descrição com o processo', [r.link_edital, r.link_foto, /0001527-31\.2025\.5\.10\.0802/.test(r.descricao)], ['https://leiloesbrasilto.com.br/edital/487', null, true]);
eq('6420 passa na qualidade', checarQualidade(r, { estrito: false }).descartar, false);

const semPopup = await parseDetalhe(ler('leilao-487'), U, { fetchFonte: async () => ({ html: null, via: 'direto-503' }), agora: HOJE });
eq('popup fora do ar: lote segue, com o motivo', [semPopup.valor_minimo, semPopup.cidade, /popup do bem não abriu \(direto-503\)/.test(semPopup.aviso)], [400000, 'Palmas', true]);

const l483 = extrairUrlsDeLote(ler('leilao-483'));
const U483 = [...l483.values()][0];
const d483 = await parseDetalhe(ler('leilao-483'), U483, { fetchFonte, agora: HOJE });
eq('483 FINALIZADO = encerrado, 19/08', [l483.size, d483.situacao, d483.encerrado, d483.data_leilao], [1, 'FINALIZADO', true, '2026-08-19T12:00:00-03:00']);
eq('483 fração ideal de 25% é descartada', checarQualidade(montarRow(U483, d483, T), { estrito: false }).descartar, true);

eq('bem que não está no leilão → null', await parseDetalhe(ler('leilao-487'), 'https://leiloesbrasilto.com.br/leilao/487#bem-1', { agora: HOJE }), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ leiloesbrasilto-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
