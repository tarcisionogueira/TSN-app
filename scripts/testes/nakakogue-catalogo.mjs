// NAKAKOGUE (05/10, #41): o detalhe vem do CARD do catálogo e a data/modalidade da HOME. Trechos REAIS
// do recon (pg_net em /lotes/consulta/1 e /).
import assert from 'node:assert/strict';
import { detalhesDoCatalogo, extrairUrlsDeLote, idDaUrl, leiloesDaHome, modalidadeDoLeilao, montarRow, TENANTS } from '../lib/nakakogue-parse.mjs';
import { cidadeDominante } from '../lib/motor/fontes/nakakogue.mjs';

const base = TENANTS.nakakogue.base;
const card = (lote, leilao, titulo, aval, min, situacao = 'À Venda') => `
  <li><section class="meio" style="width:73% !important;">
    <h3 class="titulo-lote">${lote} - <p>${titulo}</p></h3>
    <span><small>Categoria:</small> Imóveis</span>
    <span><small>Valor Avaliado: </small> R$ ${aval}</span>
    ${min ? `<span><small>Valor Minimo: </small> R$ ${min}</span>` : ''}
    <span><small>Edital:</small>  <a href="arquivos/L${leilao}/20260925_47278.pdf" target="_blank">ITAIPU</a></span>
    <span><small>Situa&ccedil;&atilde;o:</small>  ${situacao}</span>
  </section><section class="direita"><a href="detalhe-lote/${leilao}/${lote}" class="botao" />VER LOTE</a></section></li>`;
const html = `<ul class="lotes" id="itemContainer">
${card('001', '137566', 'Item 1, Quadra 11, Lote 68, ANDRADINA, AV., nº 564, Terreno (m2) 588,12, Casa (m2) 119,41, Matricula 41484, Vila A1', '744.000,00', '640.800,00')}
${card('1105', '137580', 'Apartamento-Loft n° 2307 do Edificio Mandarim, Rua Sansao Alves dos Santos. 343, Bairro Brooklin Paulista, São Paulo/SP', '900.000,00', '')}
${card('1000', '137570', 'IMOVEL: Vagas nº 24 e 25, EDIFICIO OLIMPO, Rua Rodrigues Alves, 350, Seminário, Curitiba/PR', '80.000,00', '48.000,00', 'Suspenso')}
</ul>`;

const urls = extrairUrlsDeLote(html, base);
assert.equal(urls.size, 3);
assert.equal(idDaUrl(urls.get('137566_001')), '137566_001');
const dets = detalhesDoCatalogo(html, base);
const itaipu = dets.get(`${base}/detalhe-lote/137566/001`);
assert.equal(itaipu.valor_avaliacao, 744000);
assert.equal(itaipu.valor_minimo, 640800);
assert.equal(itaipu.numero_matricula, '41484');
assert.equal(itaipu.cidade, null);                                   // card da Itaipu não nomeia a cidade
assert.equal(itaipu.link_edital, `${base}/arquivos/L137566/20260925_47278.pdf`);
assert.equal(itaipu.encerrado, false);
const loft = dets.get(`${base}/detalhe-lote/137580/1105`);
assert.deepEqual([loft.cidade, loft.estado], ['São Paulo', 'SP']);
assert.equal(loft.valor_minimo, 900000);                             // sem "Valor Minimo": usa a avaliação
assert.equal(dets.get(`${base}/detalhe-lote/137570/1000`).encerrado, true);   // "Suspenso" não entra
const row = montarRow(`${base}/detalhe-lote/137580/1105`, loft, TENANTS.nakakogue);
assert.equal(row.fonte_id, 'nakakogueleiloes_137580_1105');
assert.equal(row.tipo, 'apartamento');

const home = `<a href="lotes/137565" class="link-lote" title="2º Leilão - Massa Falida de Tecnorafia e WK - Teares e Outros" /> 2º Leilão - Massa Falida
  <p>EDITAL</p><p>Data: 06/10/2026 às 13:00:00</p><a href="lotes/137565">Acessar os Lotes</a>
  <a href="lotes/137566" class="link-lote" title="LEILÃO ITAIPU BINACIONAL ALN Nº 006/2026" /> LEILÃO ITAIPU
  <p>Data: 14/10/2026 às 09:00:00</p><a href="lotes/137566">Acessar os Lotes</a>`;
const ls = leiloesDaHome(home);
assert.deepEqual(ls.get('137566'), { nome: 'LEILÃO ITAIPU BINACIONAL ALN Nº 006/2026', data: '2026-10-14' });
assert.equal(ls.get('137565').data, '2026-10-06');
assert.equal(modalidadeDoLeilao(ls.get('137566').nome, 'judicial'), 'extrajudicial');
assert.equal(modalidadeDoLeilao(ls.get('137565').nome, 'extrajudicial'), 'judicial');

// Cidade pelo edital só quando DOMINA o texto.
assert.deepEqual(cidadeDominante('imóveis em Foz do Iguaçu/PR … Foz do Iguaçu - PR … Foz do Iguaçu/PR … leiloeiro em Curitiba/PR'), { cidade: 'Foz do Iguaçu', estado: 'PR' });
assert.equal(cidadeDominante('Curitiba/PR, Curitiba/PR, Curitiba/PR, São Paulo/SP, São Paulo/SP'), null);  // 3 × 2: ambíguo
assert.equal(cidadeDominante('Foz do Iguaçu/PR'), null);                                                    // 1 citação não basta
console.log('nakakogue-catalogo: todos os casos passaram');

// CHARSET MISTO (dry-run 05/10: 60 de 60 recusados). Página declara iso-8859-1, dados em UTF-8 e UM byte
// Latin-1 solto: tem de continuar UTF-8. Página Latin-1 de verdade: redecodifica.
import { decodificarHtml } from '../lib/motor/fetch-fonte.mjs';
const misto = Buffer.concat([Buffer.from('<meta charset="iso-8859-1"> Categoria: Imóveis · Situação À Venda · Imóveis ', 'utf8'), Buffer.from([0xe7]), Buffer.from(' fim', 'utf8')]);
assert.match(decodificarHtml(misto), /Imóveis/);
const latin = Buffer.from('<meta charset="iso-8859-1"> Categoria: Imóveis · Situação', 'latin1');
assert.match(decodificarHtml(latin), /Imóveis · Situação/);
assert.equal(decodificarHtml(Buffer.from('só UTF-8 limpo', 'utf8')), 'só UTF-8 limpo');
console.log('nakakogue-catalogo: charset misto ok');
