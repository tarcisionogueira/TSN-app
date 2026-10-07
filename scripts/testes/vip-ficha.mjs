/**
 * npm run testar:vip-ficha — o painel "Descrição" do Leilão VIP (#141). Textos REAIS do innerText
 * de 3 lotes vivos (recon-vip-descricao, 07/10 23:00), onde o extrator genérico devolvia NULL.
 */
import assert from 'node:assert/strict';
import { fichaVip } from '../lib/vip-ficha.mjs';

const ALPHA = `Comitente: BANCO BRADESCO
Arquivos Importantes
Edital
Matrícula
Descrição
Data
09/10/2026 15:00
R$ 2.121.000,00
Lote
6
Categoria
Casa
Situação
Ocupado
Leilão Único
Descrição
Endereço: ALAMEDA PICASSO (LT. 06, QD. 10), LOT ALPHAVILLE SANTANNA (BURLE MARX), 978, ALAMEDA PICASSO
Cidade: SANTANA DE PARNAÍBA Estado: SP CEP: 06539-300
Leiloeiro: VICENTE PAULO - JUCEMA N° 12/96
Casa. Áreas totais: terreno 440,18m² e construção 246,66m², sendo 12,50m² de piscina.

Matrícula nº 17.876 do RI local. Inscrição municipal 24362.12.77.0080.00.000.

Obs.: Regularização dos débitos de IPTU e Condomínio, no valor aproximado de R$ 20.000,00, apuração dos valores atualizados e o pagamento dos referidos débitos serão de inteira responsabilidade do comprador, independentemente da data do fato gerador, sem direito a reembolso. Ocupado. (AF).

Oportunidade! Este imóvel está sendo ofertado com até 30% de desconto sobre o valor de mercado.

Lance Mínimo: R$ 2.121.000,00
Notas
1. Eventuais alterações nas descrições dos imóveis, ou suas respectivas condições de venda, ocorridas até a data de realização do leilão, serão, a critério do Comitente Vendedor, noticiadas por meio deste site.
`;
const a = fichaVip(ALPHA);
assert.ok(a.descricao, 'o painel existe e tem de ser lido');
assert.match(a.descricao, /^Endereço: ALAMEDA PICASSO/);
assert.match(a.descricao, /débitos de IPTU e Condomínio, no valor aproximado de R\$ 20\.000,00/, 'o débito por conta do comprador é o que mais importa ao relatório');
assert.match(a.descricao, /Matrícula nº 17\.876/);
assert.ok(!/Eventuais alterações/.test(a.descricao), 'as Notas (texto padrão do site) não entram');
assert.ok(!/Arquivos Importantes|Categoria/.test(a.descricao), 'a 1ª "Descrição" (lista de arquivos) não abre o painel');
assert.equal(a.endereco, 'ALAMEDA PICASSO (LT. 06, QD. 10), LOT ALPHAVILLE SANTANNA (BURLE MARX), 978, ALAMEDA PICASSO');
assert.equal(a.cep, '06539300', 'formato do schema: varchar(8), só dígitos — com hífen o upsert do lote inteiro falha');
assert.ok(a.cep.length <= 8);
assert.equal(a.ocupacao, 'Ocupado');

// Judicial, com Processo e fim em "ATENÇÃO!" (lote 22603, Tijuca).
const TIJUCA = `Comitente: TRIBUNAL DE JUSTIÇA DO RIO DE JANEIRO
Arquivos Importantes
Edital
Avaliação
Matrícula
Descrição
1º Leilão
09/10/2026 11:30
R$ 1.843.992,00
Lote
1
Categoria
Prédio
Avaliação
R$ 1.843.992,00
2 Leilões
Descrição
Endereço: RUA CONDE DE BONFIM, 1148, TIJUCA
Cidade: RIO DE JANEIRO Estado: RJ CEP: 20530-003
Processo: 0063106-98.2018.8.19.0001
Leiloeiro: TASSIANA MENEZES - JUCERJA Nº 216
IMÓVEL COMERCIAL DE 3 PAVIMENTOS COM 589M² DE ÁREA EDIFICADA NA TIJUCA/RJ

MATRÍCULA Nº: 50.053 do 11º Cartório de Registro de Imóveis do Rio de Janeiro/RJ.

ÔNUS: A PENHORA do bem encontra-se nas fls. 380 dos autos, bem como no R.08 da matrícula.
ATENÇÃO!
PARCELADO (art. 895,CPC): As propostas para pagamento parcelado devem atender aos requisitos da lei.
`;
const tj = fichaVip(TIJUCA);
assert.match(tj.descricao, /Processo: 0063106-98\.2018\.8\.19\.0001/);
assert.match(tj.descricao, /ÔNUS: A PENHORA/);
assert.ok(!/PARCELADO/.test(tj.descricao));
assert.equal(tj.endereco, 'RUA CONDE DE BONFIM, 1148, TIJUCA');
assert.equal(tj.cep, '20530003');
assert.equal(tj.ocupacao, null, 'sem "Situação" no bloco: nulo, não palpite');

// Rural sem CEP (lote 22581): endereço sim, CEP nulo.
const RURAL = `Lote
2
Categoria
Imóvel Rural
Descrição
Endereço: RODOVIA MT-403 - FAZENDA SANTA CLARA (GLEBA 01), S/N, ZON RURAL
Cidade: CAMPO VERDE Estado: MT
Processo: 1006372-41.2021.8.26.0024
Leiloeiro: EDUARDO JORDÃO BOYADJIAN - JUCESP Nº 464
FAZENDA SANTA CLARA GLEBA 01 COM 843,0610 HECTARES EM CAMPO VERDE/MT
Navegue Pelo Site
`;
const r = fichaVip(RURAL);
assert.equal(r.endereco, 'RODOVIA MT-403 - FAZENDA SANTA CLARA (GLEBA 01), S/N, ZON RURAL');
assert.equal(r.cep, null);
assert.match(r.descricao, /843,0610 HECTARES/);
assert.ok(!/Navegue/.test(r.descricao));

// Página sem o painel (ou que mudou): tudo nulo — nunca o menu como descrição.
const nada = fichaVip('Entrar | Cadastrar\nDescrição\nNotas\nNavegue Pelo Site');
assert.deepEqual(nada, { descricao: null, endereco: null, cep: null, ocupacao: null });
assert.deepEqual(fichaVip(''), { descricao: null, endereco: null, cep: null, ocupacao: null });
assert.equal(fichaVip('Situação\nDesocupado\n'.replace(/^/, '\n')).ocupacao, 'Desocupado');

console.log('vip-ficha: todos os casos passaram');
