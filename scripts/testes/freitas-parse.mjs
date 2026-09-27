// Freitas Leiloeiro: trechos REAIS do recon de 27/09 (recon_dump origem='deep', ids 53/55/56).
// Casos: (1) catálogo guarda valor/cidade do card; (2) lote com data e lance no detalhe (Rio
// Branco/AC); (3) lote "ABERTO PARA PROPOSTAS" sem valor no detalhe — valor vem do card (São
// Paulo/SP); (4) o `<script` sem par no topo da página NÃO pode apagar o conteúdo do lote;
// (5) lote de veículo (tipo 1) não entra.
import assert from 'node:assert/strict';
import { extrairUrlsDeLote, parseDetalhe, idDaUrl, CARDS, montarRow, TENANTS } from '../lib/freitas-parse.mjs';

const BASE = 'https://www.freitasleiloeiro.com.br';
const TOPO = '<html><head><script>var x = "<script"; </head><body><script src="/js/a.js"></script>';

const catalogo = `${TOPO}<div class="row"><div class="col-md-4 col-6 mb-3"><div class="cardlote"> <div class="cardlote-header"> <div class="cardLote-lote"> 001 </div></div>
 <a href="/Leiloes/LoteDetalhes?leilaoId=7924&amp;loteNumero=1" target="_blank"> <img src="https://cdn3.freitasleiloeiro.com.br/LEILOES/7924/FOTOS/001/LT001_01.JPG" class="cardLote-img"> </a>
 <div class="cardLote-data"> <span>-</span> </div> <div class="cardLote-descBens"> <span class="small">São Paulo/SP. Conjunto comercial no 2º andar ou 4º pavimento do Edifício Pekelma...</span> </div>
 <div class="cardLote-vlr">R$ 1.900.000,00</div> <div class="cardLote-lance">Lance Inicial</div>
 <div class="cardLote-details"> <span class=""><svg class="svg-inline--fa"><path d="M32 32"></path></svg> SAO PAULO/SP</span> </div>
 <a href="/Leiloes/LoteDetalhes?leilaoId=7924&amp;loteNumero=1"><span>ABERTO PARA PROPOSTAS</span></a></div></div>
 <div class="col-md-4 col-6 mb-3"><div class="cardlote"> <a href="/Leiloes/LoteDetalhes?leilaoId=8051&amp;loteNumero=1"></a>
 <div class="cardLote-vlr">R$ 113.000,00</div> <div class="cardLote-details"> <span> RIO BRANCO/AC</span> </div></div></div></div>`;

const urls = extrairUrlsDeLote(catalogo, BASE);
assert.deepEqual([...urls.keys()], ['7924-1', '8051-1']);
assert.equal(urls.get('7924-1'), `${BASE}/Leiloes/LoteDetalhes?leilaoId=7924&loteNumero=1`);
assert.deepEqual(CARDS.get('7924-1'), { valor: 1900000, cidade: 'Sao Paulo', estado: 'SP' });
assert.equal(idDaUrl(`${BASE}/Leiloes/LoteDetalhes?leilaoId=8051&loteNumero=001`), '8051-1');

const detalhe = ({ id, data, hora, status, endereco, desc, lances, tipo }) => `${TOPO}
<title>Lote: 001 | Freitas Leiloeiro</title><div id="dvFotos"> <img class="w-100 imgLotePrincipal h-100" src="https://cdn3.freitasleiloeiro.com.br/LEILOES/${id}/FOTOS/001/LT001_01.jpg"> </div>
<script> var leilaoId = parseInt('${id}'); const tiposImoveis = [19]; var tipoGererico = (tiposVeiculos.indexOf(parseInt('${tipo}')) > -1 ? 'veiculos' : (tiposImoveis.indexOf(parseInt('${tipo}')) > -1 ? 'imoveis' : 'materiais')); </script>
<div>Lote 001</div><div>Data do Leilão</div><div>${data}</div><div>Horário</div><div>${hora}</div> <div>Visitas 367</div><div>Curtidas 0</div> <div>${status}</div>
<a href="https://cdn3.freitasleiloeiro.com.br/leiloes/${id}/condicao/condicao_${id}.pdf">Condições de venda</a> <a href="https://cdn3.freitasleiloeiro.com.br/leiloes/${id}/edital/edital_${id}.pdf">Edital / Anúncio</a>
<a href="https://cdn3.freitasleiloeiro.com.br/leiloes/${id}/catalogo/catalogo_${id}.pdf">Catálogo do leilão</a> Como participar
<p>Endereço: ${endereco}</p> <p>Descrição completa: ${desc}</p> <p>Informações importantes: Fotos Meramente Ilustrativas;</p>
<a href="https://cdn3.freitasleiloeiro.com.br/leiloes/${id}/matricula/001/matricula_001.pdf">Matrícula</a>
${lances} <script> var retornarMaiorLanceLote = function () { $.ajax({ url: "/Leiloes/ListarLancesLote?leilaoId=" + leilaoId`;

// (2) Rio Branco/AC — com data e lance
const rb = parseDetalhe(detalhe({
  id: 8051, data: '28/09/2026', hora: '10:00', status: 'ABERTO', tipo: 19,
  endereco: 'Rua Andirá, 180 (Lt. 373 da qd. 196), Bairro Defesa Civil - Rio Branco/AC',
  desc: 'Rio Branco-AC. Bairro Defesa Civil. Rua Andirá, 180 (Lt. 373 da qd. 196). Casa. Áreas totais: terr. 340,92m² e constr. 84,00m² (estimada no local 129,00m²). Matr. 80.554 do 1º RI local. Ocupada. (AF). (Cód. do imóvel 25458).',
  lances: 'Área de Lances --> R$ 113.000,00 Lance Mínimo R$ 3.000,00 Incremento Mínimo',
}), `${BASE}/Leiloes/LoteDetalhes?leilaoId=8051&loteNumero=1`);
assert.equal(rb.titulo, 'Casa - Rio Branco/AC');
assert.equal(rb.cidade, 'Rio Branco'); assert.equal(rb.estado, 'AC');
assert.equal(rb.data_leilao, '2026-09-28');
assert.equal(rb.valor_minimo, 113000);
assert.equal(rb.modalidade, 'extrajudicial');
assert.equal(rb.numero_matricula, '80.554');
assert.equal(rb.area_m2, 340.92);
assert.equal(rb.link_edital, 'https://cdn3.freitasleiloeiro.com.br/leiloes/8051/edital/edital_8051.pdf');
assert.equal(rb.link_matricula, 'https://cdn3.freitasleiloeiro.com.br/leiloes/8051/matricula/001/matricula_001.pdf');
assert.equal(rb.anexos.length, 4);
assert.equal(rb.link_foto, 'https://cdn3.freitasleiloeiro.com.br/LEILOES/8051/FOTOS/001/LT001_01.jpg');
assert.match(rb.descricao, /^Rio Branco-AC\. Bairro Defesa Civil.*\(Cód\. do imóvel 25458\)\.$/);   // (4) o <script solto não apagou
assert.equal(rb.encerrado, false);

// (3) São Paulo/SP — propostas, sem valor nem data no detalhe
const sp = parseDetalhe(detalhe({
  id: 7924, data: '-', hora: '-', status: 'ABERTO PARA PROPOSTAS', tipo: 19,
  endereco: 'Largo do Arouche, nº 24, Largo do Arouche - Sao Paulo/SP',
  desc: 'São Paulo/SP. Conjunto comercial no 2º andar ou 4º pavimento do Edifício Pekelman, situado no Largo do Arouche, nº 24 (entrada principal), com área privativa de 553,32m², área comum de 76,19m² e a área total construída de 629,51m², registrado no 5º Cartório de Registro de Imóveis de São Paulo/SP sob nº 53.610. IMÓVEL DESOCUPADO.',
  lances: '',
}), `${BASE}/Leiloes/LoteDetalhes?leilaoId=7924&loteNumero=1`);
assert.equal(sp.titulo, 'Conjunto Comercial - Sao Paulo/SP');
assert.equal(sp.valor_minimo, 1900000);            // do card, não inventado
assert.equal(sp.data_leilao, null);
assert.equal(sp.modalidade, 'venda_direta');
assert.equal(sp.numero_matricula, '53.610');
assert.equal(sp.area_m2, 553.32);

const row = montarRow(`${BASE}/Leiloes/LoteDetalhes?leilaoId=7924&loteNumero=1`, sp, TENANTS.freitas);
assert.equal(row.fonte, 'FREITAS'); assert.equal(row.fonte_id, 'freitas_7924-1'); assert.equal(row.tipo, 'comercial');

// (5) veículo que escapasse do filtro de categoria não vira imóvel
const carro = parseDetalhe(detalhe({ id: 8079, data: '29/09/2026', hora: '10:00', status: 'ABERTO PARA LANCES', tipo: 1,
  endereco: '', desc: 'I/CHEV TRACKER LTZ AT, 13/14', lances: 'R$ 31.000,00 Lance Inicial' }), `${BASE}/Leiloes/LoteDetalhes?leilaoId=8079&loteNumero=1`);
assert.equal(carro.encerrado, true);

// lote vendido sai como encerrado
const vendido = parseDetalhe(detalhe({ id: 8051, data: '28/09/2026', hora: '10:00', status: 'VENDIDO', tipo: 19,
  endereco: 'Rua X - Rio Branco/AC', desc: 'Casa.', lances: '' }), `${BASE}/Leiloes/LoteDetalhes?leilaoId=8051&loteNumero=2`);
assert.equal(vendido.encerrado, true);

console.log('freitas-parse: todos os casos passaram');
