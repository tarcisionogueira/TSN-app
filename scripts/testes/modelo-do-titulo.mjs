// Teste de modeloDoTitulo (#291, 22/10) — títulos reais de veículos ativos sem modelo.
import { modeloDoTitulo } from '../lib/veiculo-do-lote.mjs';
let falhas = 0;
const caso = (t, marca, modelo) => {
  const r = modeloDoTitulo(t);
  const ok = (r?.marca ?? null) === marca && (r?.modelo ?? null) === modelo;
  if (!ok) { falhas++; console.error('✗', t, '→', JSON.stringify(r), 'esperado', marca, modelo); } else console.log('✓', t.slice(0, 50), '→', modelo);
};
caso('GM/ZAFIRA COMFORT – 09/09 – Ponta Porã/MSPonta Porã/MS', 'CHEVROLET', 'ZAFIRA COMFORT');
caso('Honda/Civic LXL - 12/12 - Guaíra/SPGuaíra/SP', 'HONDA', 'CIVIC LXL');
caso('FORD/DEL REY 1.8 GL – 91/91 – Dourados/MSNaviraí/MS', 'FORD', 'DEL REY 1.8 GL');
caso('VW/Gol - 15/15 - Itumbiara/GOItumbiara/GO', 'VOLKSWAGEN', 'GOL');
caso('CHEVROLET/ONIX 1.0MT LS - 16/16 - BrancoCanoas/RS', 'CHEVROLET', 'ONIX 1.0MT LS');
caso('Caminhão, Volkswagen - 2003', 'VOLKSWAGEN', null);
caso('Carro Fiat Strada Working - 2014', 'FIAT', 'STRADA WORKING');
caso('Carro Fiat Palio Weekend Adventure 1.8 Flex - 2013 (Lote 01)', 'FIAT', 'PALIO WEEKEND ADVENTURE 1.8 FLEX');
caso('MERCEDES-BENZ SPRINTER TCA AMB ANO: 2020/2021 PLACA FINAL 7 (SC)', 'MERCEDES-BENZ', 'SPRINTER TCA AMB');
caso('Ford/Ka Se 1.5 Sd C - 2020/2020 - Placa FINAL: 6A33', 'FORD', 'KA SE 1.5 SD C');
caso('FORD FIESTA EDGE, 03/03, GASOLINA, SUCATA APROVEITÁVEL.', 'FORD', 'FIESTA EDGE');
caso('VW/GOL', 'VOLKSWAGEN', 'GOL');
caso('HONDA CG 125 2008 2008 Sucata Motor Servível', 'HONDA', 'CG 125');
caso('Sucata Destinada A Desmontagem Com Aproveitamento De Motor - FIAT SIENA ELX 2001/2001', 'FIAT', 'SIENA ELX');
caso('VW 12.140H 1998/1998', 'VOLKSWAGEN', '12.140H');
caso('Sem Prazo Para Desvinculação - Veículo conservado - HONDA CB250F TWISTER ABS 2021/2022', 'HONDA', 'CB250F TWISTER ABS');
caso('Sem Prazo Para Desvinculação - Veículo conservado - DAFRA CITYCOM 300I 2012/2013', 'DAFRA', 'CITYCOM 300I');
caso('Automóvel', null, null);
caso('Veículos - VW em leilão - Rua Treze de Maio, 2256 - Ibitinga/SP', 'VOLKSWAGEN', null);
caso('Reboque - FNV - FRUEHAUF - 82/82 - Vespasiano/MG', null, null);
caso('VW GOL 1.0 PRATA 2011 2012 - SINISTRADO-MEDIA MONTA', 'VOLKSWAGEN', 'GOL 1.0');
caso('VEÍCULO SUCATA VW/SANTANA BRANCO ANO 2003 – PLACA CYB2258/PR', 'VOLKSWAGEN', 'SANTANA');
caso('GMC CORSA WIND 1995 1996 AZUL', 'CHEVROLET', 'CORSA WIND');
caso('IMP/M.BENZ MB 180D - 95/95 - Carapicuíba/SP', 'MERCEDES-BENZ', 'MB 180D');
caso('I/NISSAN VERSA 16SV FLEX – 11/11 – Campo Grande/MS', 'NISSAN', 'VERSA 16SV FLEX');
caso('GAIOLA DE FERRO  2,00 X 2,26 M ID #3802172', null, null);
caso('bomba de concreto  BLP500 MB1215', null, null);
caso('CARRO FORTE | CAMINHAO M.BENZ/915C, Accelo | 2007/2008', 'MERCEDES-BENZ', '915C');
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1); }
console.log('✓ modelo-do-titulo: todos os casos passaram');
