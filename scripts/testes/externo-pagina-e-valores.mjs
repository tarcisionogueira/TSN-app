// /externo/ (Leiloar, 13/10): página do leilão 2255 (Sanches) e tabela de arquivos REAIS + extração de valores.
import assert from 'node:assert/strict';
import { lerPaginaLeilao, lerArquivos, cidadeUf, valoresDoTexto, extrairUrlsDeLote } from '../lib/externo-parse.mjs';

const pagina = `<div class="badge badge-success mt-2" style="x"> ABERTO</div></div></div></div><div class="col-12"><h6 class="text-center mb-3"> <strong>TERRENO 125,00M² | ITANHAÉM/SP | ALIENAÇÃO POR INICIATIVA PARTICULAR TRT 2ª REGIÃO</strong></h6></div><div class="col-12 col-md-6"> <b>Data</b><p> 19/11/2026
às
10:00:00</p></div><div class="col-12"> <b>LOCAL:</b> ITANHAEM-SP</div>
<input type="hidden" name="data[Bem][cabecalho_id]" value="2256" id="BemCabecalhoId"/>`;
const p = lerPaginaLeilao(pagina);
assert.deepEqual([p.status, p.data, p.hora, p.cabecalho, p.local], ['ABERTO', '2026-11-19', '10:00', '2256', 'ITANHAEM-SP']);
assert.match(p.titulo, /^TERRENO 125,00M²/);
assert.deepEqual(cidadeUf(p.titulo, p.local), { cidade: 'ITANHAÉM', uf: 'SP' });
assert.deepEqual(cidadeUf('CASA | sem cidade', 'SÃO PAULO-SP'), { cidade: 'SÃO PAULO', uf: 'SP' });

const arqs = lerArquivos(`<tbody><tr><td>Edital</td><td>Edital</td><td><a href="/externo/cabecalhos/../../arquivos/arquivos_leilao/1790863422.pdf" target="_blank"><i></i> Ver Arquivo</a></td></tr><tr><td>Matrícula</td><td>Matrícula</td><td><a href="/externo/cabecalhos/../../arquivos/arquivos_leilao/1790863352.pdf" target="_blank">Ver</a></td></tr></tbody>`, 'https://www.sanchesleiloes.com.br');
assert.deepEqual(arqs.map(a => a.nome), ['Edital', 'Matrícula']);
assert.equal(arqs[0].url, 'https://www.sanchesleiloes.com.br/arquivos/arquivos_leilao/1790863422.pdf');

assert.deepEqual(valoresDoTexto('O imóvel foi avaliado em R$ 150.000,00 (cento e cinquenta mil). Lance mínimo: R$ 75.000,00.'), { avaliacao: 150000, minimo: 75000, pctMinimo: null });
const pct = valoresDoTexto('Valor da avaliação: R$ 200.000,00. A venda se dará por valor não inferior a 60% (sessenta por cento) do valor da avaliação.');
assert.equal(pct.avaliacao, 200000); assert.equal(pct.minimo, 120000);
assert.deepEqual(valoresDoTexto('sem números'), { avaliacao: 0, minimo: 0, pctMinimo: null });

// Formas reais do edital TRT-2 (13/10): mínimo com o percentual (avaliação sai dele) e 1º leilão pela avaliação.
const ref = valoresDoTexto('Fixo o preço mínimo de R$ 600.000,00 (seiscentos mil reais), referente a 60% do valor da avaliação realizada pelo Oficial de Justiça.');
assert.equal(ref.minimo, 600000); assert.equal(ref.avaliacao, 1000000);
const primeiro = valoresDoTexto('Bem avaliado em R$ 690.000,00. No 1º leilão os bens somente poderão ser arrematados por valor igual ou superior ao de sua avaliação.');
assert.deepEqual([primeiro.avaliacao, primeiro.minimo], [690000, 690000]);
assert.equal(valoresDoTexto('custas de R$ 1.080,00 a título de avaliação').avaliacao, 0, 'piso de R$ 10 mil');

const urls = extrairUrlsDeLote('<a href="/externo/leilao/2255">x</a><a href="/externo/leilao/2251">y</a>', 'https://www.sanchesleiloes.com.br');
assert.deepEqual([...urls.keys()], ['2255', '2251']);
console.log('✓ externo-pagina-e-valores: página do leilão, arquivos nomeados, cidade/UF e valores do edital');
