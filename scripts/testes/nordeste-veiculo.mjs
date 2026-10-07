// Veículos da NORDESTE (30/09): só veículo INTEIRO entra; marca/modelo/ano do título; placa, chassi,
// Renavam e local da DESCRIÇÃO do lote. Slugs e título reais do evento 213 (TRT-5).
import assert from 'node:assert/strict';
import { ehVeiculoInteiro, marcaModeloAno, tipoVeiculo } from '../lib/nordeste-veiculo.mjs';
import { numPayload } from '../lib/dom-parse-util.mjs';

const U = (s) => `https://www.nordesteleiloes.com.br/lotes/${s}`;
assert.ok(ehVeiculoInteiro(U('213-065-automovel-chevrolets10-ltz-dd2-28-tdi-4x2-cd-dies-aut-ano-20122013')));
assert.ok(ehVeiculoInteiro(U('213-001-motocicleta-yamahaybr125i-factor-ed-ano-20212022')));
assert.ok(ehVeiculoInteiro(U('213-027-veiculo-itoyota-hilux-4cd-sr5-ano-19981998')));
assert.ok(ehVeiculoInteiro(U('213-066-onibus-marcamodelo-mbenzmpolo-sen-midi-on-ano-20062006')));
assert.ok(!ehVeiculoInteiro(U('128-010-sucata-de-motocicleta-honda-cg-titan')), 'sucata fora');
assert.ok(!ehVeiculoInteiro(U('213-024-embarcacao-costa-do-sol-ii')), 'embarcação não é veículo');
assert.ok(!ehVeiculoInteiro(U('213-053-apartamento-itabunaba')));
assert.ok(!ehVeiculoInteiro(U('213-010-freezer-esmaltec-468l')));

assert.deepEqual(marcaModeloAno('AUTOMÓVEL CHEVROLET/S10 LTZ DD2 2.8 TDI 4X2 CD DIES. AUT, ANO 2012/2013'),
  { marca: 'CHEVROLET', modelo: 'S10 LTZ DD2 2.8 TDI 4X2 CD DIES. AUT', ano_fabricacao: 2012, ano_modelo: 2013 });
const hilux = marcaModeloAno('VEÍCULO I/TOYOTA HILUX 4CD SR5, ANO 1998/1998');
assert.equal(hilux.marca, 'TOYOTA'); assert.equal(hilux.modelo, 'HILUX 4CD SR5'); assert.equal(hilux.ano_modelo, 1998);
assert.equal(marcaModeloAno('MOTOCICLETA HONDA/CG 160 FAN, ANO 2018/2018').marca, 'HONDA');
assert.equal(tipoVeiculo('MOTOCICLETA HONDA/CG 160 FAN'), 'moto');
assert.equal(tipoVeiculo('ÔNIBUS M.BENZ/MPOLO SEN MIDI'), 'onibus');
assert.equal(tipoVeiculo('AUTOMÓVEL CHEVROLET/S10'), 'carro');
// Lote de pátio sem o tipo no título (seco de 30/09: saíam como "carro")
assert.equal(tipoVeiculo('VEÍCULO CONSERVADO HONDA CG 125 CARGO - 2003/2003'), 'moto');
assert.equal(tipoVeiculo('VEÍCULO CONSERVADO DAFRA SUPER 100 - 2010/2010'), 'moto');
assert.equal(tipoVeiculo('VEÍCULO CONSERVADO HONDA CIVIC LXS - 2010/2010'), 'carro');
assert.equal(tipoVeiculo('VEÍCULO CONSERVADO HONDA FIT - 2010/2010'), 'carro');
{
  const { areaDoTitulo } = await import('../lib/nordeste-parse.mjs');
  assert.equal(areaDoTitulo('TERRENO URBANO Nº 3 COM 800,00 M2, TIETÊ/SP'), 800);
  assert.equal(areaDoTitulo('LOTE URBANO COM 175 M², BOM JESUS DA LAPA/BA'), 175);
  assert.equal(areaDoTitulo('IMÓVEL RURAL COM 196,62 HA'), 1966200);
  assert.equal(areaDoTitulo('FAZENDA COM 1.200,5 HECTARES'), 12005000);
  assert.equal(areaDoTitulo('Imóvel Rural Ladeira do Alto Com 18ha 52a e 51ca'), 185251);
  assert.equal(areaDoTitulo('Sitio Pe de Serra Com 1ha 96a e 62ca'), 19662);
  assert.equal(areaDoTitulo('POSSE QUALIFICADA APTA AO USUCAPIÃO'), 0);
}
// Valor do payload (seco de 30/09: S10 com lance R$ 411.948 em vez de R$ 41.194,80).
assert.equal(numPayload(41194.8), 41194.8);
assert.equal(numPayload('41194.8'), 41194.8);
assert.equal(numPayload('15920.00'), 15920);
assert.equal(numPayload('41.194,80'), 41194.8);
assert.equal(numPayload('380.000'), 380000, 'ponto de milhar pt-BR continua milhar');
const gol = marcaModeloAno('VEÍCULO CONSERVADO VW GOL 1.0 - 2004/2005');
assert.equal(gol.marca, 'VW'); assert.equal(gol.modelo, 'GOL 1.0'); assert.equal(gol.ano_modelo, 2005);
// Foto (05/10): só entra `fotos` quando houve foto — sem ela, a chave nem vai (null apagaria a gravada).
{
  const { montarRowVeiculo } = await import('../lib/nordeste-veiculo.mjs');
  const base = { titulo: 'AUTOMÓVEL VW/GOL', marca: 'VW', modelo: 'GOL', valor_minimo: 5000, encerrado: false };
  const url = 'https://nordesteleiloes.com.br/lotes/213-065-automovel-vw-gol';
  assert.deepEqual(montarRowVeiculo(url, { ...base, foto: 'https://nordesteleiloes-files.s3.amazonaws.com/lotes/fotos/a.png' }).fotos, ['https://nordesteleiloes-files.s3.amazonaws.com/lotes/fotos/a.png']);
  assert.equal('fotos' in montarRowVeiculo(url, { ...base, foto: null }), false);
  // PÁTIO SEM FICHA (07/10): medido no acervo — os 112 ativos dos leilões 197–207 (de pátio) tinham
  // `descricao` de 41–57 caracteres, que é o TÍTULO entrando pelo fallback, e saíam com o motivo
  // "sem sinal de pátio na ficha". Veredito sobre ficha não lida. Sem ficha o motivo precisa DIZER
  // que não leu; o status segue 'indefinido' (lado seguro: não aparece em /veiculos).
  const semFicha = montarRowVeiculo(url, { ...base, descricao: 'VEICULO CONSERVADO HONDA / CG 125 TITAN KS - 2003/2003', ficha: null });
  assert.equal(semFicha.status_patio, 'indefinido');
  assert.match(semFicha.status_patio_motivo, /ficha do lote não lida/);
  // Com ficha de verdade, o classificador único continua mandando (lote 213-027, texto real).
  const comFicha = montarRowVeiculo(url, { ...base, ficha: 'Bens: 01 (UM) AUTOMOTOR DE PLACA JML2C96 … Localização do Bem: RUA A, CENTRO, PIRITIBA/BA.' });
  assert.equal(comFicha.status_patio, 'nao_confirmado');
  // "NÃO LI" × "NÃO EXISTE" (recon na página viva, 07/10): no lote de pátio o payload vem completo
  // e `description` é string vazia — o leiloeiro não publica descrição. Dizer "não li" ali mandaria
  // consertar um parser intacto; o motivo precisa separar os dois casos.
  const vazia = montarRowVeiculo(url, { ...base, ficha: null, fichaVazia: true });
  assert.equal(vazia.status_patio, 'indefinido');
  assert.match(vazia.status_patio_motivo, /não publica descrição/);
}
// ─── LEILÃO DE PÁTIO COMO PROVA (07/10, decisão do dono) ────────────────────────────────────
{
  const { ehLoteDePatio, promoverLeilaoDePatio } = await import('../lib/nordeste-veiculo.mjs');
  // Títulos REAIS do acervo (07/10): 125 de 125 lotes dos 7 leilões de pátio, 0 de 5 do judicial.
  assert.ok(ehLoteDePatio('VEICULO CONSERVADO DAFRA / SUPER 100 - 2009/2010'));
  assert.ok(ehLoteDePatio('VEÍCULO CONSERVADO HONDA / CG 125 CARGO - 2002/2003'));
  // Dois lotes do leilão 207 vêm com "\t" LITERAL (barra-t, não tabulação) colado no título.
  // Sem engoli-lo a regra acertaria 123 de 125 — e a diferença passaria despercebida.
  assert.ok(ehLoteDePatio('\\tVEICULO CONSERVADO GM / CORSA SUPER - 1997/1997'));
  assert.ok(ehLoteDePatio('\tVEICULO CONSERVADO HONDA / CG 125 TITAN KS - 2003/2003'));
  // Lote judicial NÃO entra: lá a ficha existe e o classificador é que manda.
  assert.ok(!ehLoteDePatio('MOTOCICLETA YAMAHA/YBR125I FACTOR ED, ANO 2021/2022'));
  assert.ok(!ehLoteDePatio('AUTOMÓVEL CHEVROLET/S10 LTZ, ANO 2012/2013'));
  assert.ok(!ehLoteDePatio('SUCATA DE VEICULO CONSERVADO'), 'a marca é no COMEÇO do título');

  const lote = (id, titulo, status_patio) => ({ fonte_id: `nordeste_${id}`, titulo, status_patio, status_patio_motivo: 'x' });
  const r1 = promoverLeilaoDePatio([
    lote('197-001', 'VEICULO CONSERVADO DAFRA / SUPER 100 - 2009/2010', 'indefinido'),
    lote('197-002', 'VEICULO CONSERVADO HONDA / CG 125 - 2002/2003', 'indefinido'),
  ]);
  assert.equal(r1[0].status_patio, 'confirmado');
  assert.match(r1[0].status_patio_motivo, /leilão de pátio da Nordeste/);
  assert.equal(r1[1].status_patio, 'confirmado');

  // TEXTO VENCE INFERÊNCIA: lote cuja ficha foi lida e classificada não é tocado.
  const r2 = promoverLeilaoDePatio([lote('197-003', 'VEICULO CONSERVADO FIAT / UNO', 'nao_confirmado')]);
  assert.equal(r2[0].status_patio, 'nao_confirmado');

  // VETO POR LEILÃO: um lote com sinal de executado derruba a prova do leilão INTEIRO — a rede
  // de segurança do dono (nunca exibir bem em posse do executado) não cede a uma inferência.
  const r3 = promoverLeilaoDePatio([
    lote('200-001', 'VEICULO CONSERVADO VW / GOL', 'indefinido'),
    lote('200-002', 'VEICULO CONSERVADO FORD / KA', 'excluido'),
    lote('201-001', 'VEICULO CONSERVADO FIAT / PALIO', 'indefinido'),  // outro leilão: não é vetado
  ]);
  assert.equal(r3[0].status_patio, 'indefinido', 'leilão com executado não promove');
  assert.equal(r3[1].status_patio, 'excluido');
  assert.equal(r3[2].status_patio, 'confirmado', 'o veto é por leilão, não global');

  // Lote judicial no meio da lista continua intocado.
  const r4 = promoverLeilaoDePatio([lote('213-001', 'MOTOCICLETA YAMAHA/YBR125I', 'indefinido')]);
  assert.equal(r4[0].status_patio, 'indefinido');
}
console.log('nordeste-veiculo: todos os casos passaram');
