// 4º template da Leiloar (06/11): trechos REAIS do lote 500 da ML Leilões (pg_net, 06/11), montados num HTML mínimo.
import assert from 'node:assert/strict';
import { parseDetalhe } from '../lib/leiloar-parse.mjs';

const url = 'https://mlleiloes.com.br/externo/lote/500/de-acordo-com-a-matricula-em-poxoreu';
const html = `<html><body>
<div class="cabecalho"><div class="img-container"> <a href="javascript:void()" title="Oceana"> <img src="https://mlleiloes.com.br/externo/../arquivos/icones/4fc3b38aa8f7d0f70bd31105735bafcc.jpg" width="140" height="90" alt="" /> </a></div> <span class="nome">LEILÃO JUDICIAL ESTADUAL ON-LINE COMARCA DE RONDONÓPOLIS (MT)</span><div class="infos"> <span class="tipo">Eletrônico e Presencial</span><ul class="datas"><li>Data: 16/11/2026 às 10:00:00 horas.</li><li class="right">Data: 17/11/2026 às 10:00:00 horas.</li></ul> <span class="local">Local:  , RONDONOPOLIS-MT</span> <span class="status sts-azul">ABERTO PARA LANCES</span></div></div><div class="texto-topo"></div><div class="texto-meio"><p class="first last"><b>LEILOEIRO OFICIAL: SILVIO LUIZ SILVA DE MOURA LEITE</b><br><br></p></div>
<div class="detalhes"><div class="info-top-lote"> <a href="/externo/bens/../../arquivos/arquivos_bem/Lote_03_Segunda_Vara_Civel_de_Rondonopolis_0005437_21_2009_8_11_0003.pdf" title="Ver Edital" class="edital-download" target="_blank">Edital</a> <span id="status" class="sts-verde">ABERTO</span><h2 id="numero_lote">Lote 03</h2> <span class="categoria-bem"> IMÓVEIS RURAIS FAZENDAS  - </span></div><div id="galeria"><div class="ampliada"><a href="/externo/bens/../../arquivos/bem_foto/0422261001793720240.png" class="imagem-0"> <img src="https://mlleiloes.com.br/externo/../arquivos/bem_foto/0422261001793720240.png" width="280" height="167" alt="" /> </a></div></div>
<div class="info-edital"></div><div id="descricao"><h2>Descrição do bem:</h2><p> De acordo com a matrícula anexa de nº 6.835 do Cartório do Registro de Imóveis de Poxoréo-
MT (atualmente Poxoréu), a descrição do imóvel é a seguinte: Tipo e Denominação: Trata-se de uma gleba
de terras denominada Fazenda Santo Antonio. Localização: O imóvel está situado no Município e Comarca
de Poxoréo-MT. Área Total: A propriedade possui uma área de 81,58,75 hectares.</p></div>
<div class="infos-top"><ul id="valores"><li> <strong>Avaliação: </strong> <span>R$ 1.223.700,00</span></li><li> <strong>Lance Mínimo: </strong> <span>R$ 616.850,00</span></li><li> <strong>Incremento: </strong> <span>R$ 12.000,00</span></li></ul></div></div>
</body></html>`;

const d = parseDetalhe(html, url, { agora: new Date('2026-11-06T12:00:00Z') });
assert.ok(d, 'template cabecalho reconhecido (antes: null = "parser não leu a página")');
assert.ok(!d.encerrado, 'ABERTO');
assert.equal(d.valor_avaliacao, 1223700);
assert.equal(d.valor_minimo, 616850);
assert.match(String(d.data_leilao), /^2026-11-16/);
assert.match(String(d.data_leilao_2 || ''), /^2026-11-17/);
assert.match(String(d.link_edital), /arquivos\/arquivos_bem\/Lote_03_.*\.pdf$/);
assert.match(String(d.link_foto), /bem_foto\/0422261001793720240\.png$/);
assert.ok(!d.naoImovel, 'categoria IMÓVEIS RURAIS FAZENDAS é imóvel');
assert.match(String(d.descricao), /Fazenda Santo Antonio/);

// Categoria de veículo (Hatory: frota de prefeitura) → não-imóvel.
const veic = parseDetalhe(html.replace('IMÓVEIS RURAIS FAZENDAS', 'VEÍCULOS LEVES'), url, { agora: new Date('2026-11-06T12:00:00Z') });
assert.ok(veic?.naoImovel, 'veículo sai como não-imóvel');
console.log('✓ leiloar 4º template (cabecalho): ML lote 500 — valores, datas, edital, foto, categoria');
