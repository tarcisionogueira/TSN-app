// GESTÃO DE LEILÕES pela VIA GRÁTIS (26/10). Fixture REAL: evento 3766 da Fidalgo lido pelo BANCO (pg_net) — o
// back-office serve latin1 e o banco entrega cada acentuada como U+FFFD ("IM�VEL", "S�o Paulo"). Prova:
//   1. repararLatin1Perdido reconstrói pelo léxico/sufixo e NUNCA mexe em texto sem U+FFFD;
//   2. o layout "lotePadrao" (novo na Fidalgo) sai com cidade/UF/bairro do "Local do bem", lance, praças do
//      cabeçalho e fonte_id com o domínio (instalação própria: o idLote não é do backend compartilhado);
//   3. completude: "Exibindo resultado 1 a 2 de 2" = 2 cards lidos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repararLatin1Perdido } from '../lib/reparar-latin1.mjs';
import { ehPadrao, fatiarCardsPadrao, pracasPadrao, parseCardPadrao } from '../lib/gestao-padrao.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

const F = '�';
assert.equal(repararLatin1Perdido('Rua Augusta, 100 - São Paulo/SP'), 'Rua Augusta, 100 - São Paulo/SP', 'texto íntegro não muda');
assert.equal(repararLatin1Perdido(`IM${F}VEL: Matr${F}cula 1 - 11${F} Cart${F}rio de S${F}o Paulo`), 'IMÓVEL: Matrícula 1 - 11º Cartório de São Paulo');
assert.equal(repararLatin1Perdido(`1${F} Pra${F}a`), '1ª Praça');
assert.equal(repararLatin1Perdido(`ALIENA${F}${F}O`), 'ALIENAÇÃO');
assert.equal(repararLatin1Perdido(`Fidalgo Leil${F}es`), 'Fidalgo Leilões');
assert.equal(repararLatin1Perdido(`x${F}y`), `x${F}y`, 'sem léxico nem sufixo: fica como veio (não chuta)');

const cru = readFileSync(new URL('./fixtures/gestao-fidalgo-evento-3766-banco.html', import.meta.url), 'utf8');
assert.ok(cru.includes(F), 'a fixture é a do banco, com U+FFFD');
const h = repararLatin1Perdido(cru);
const txt = decodificarEntidades(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
assert.ok(ehPadrao(h));
assert.deepEqual(pracasPadrao(txt), { data_leilao: '2026-11-17', data_leilao_2: '2026-11-24' }, 'encerramento de cada praça, não a abertura');
const total = Number(txt.match(/Exibindo resultado\s*\d+\s*a\s*\d+\s*de\s*(\d+)/i)[1]);
const cards = fatiarCardsPadrao(h);
assert.equal(total, 2);
assert.equal(cards.length, total, 'completude: todos os lotes declarados');
const ctx = { dominio: 'www.fidalgoleiloes.com.br', idLeilao: '3766', leiloeiro: 'Fidalgo Leilões', htmlEvento: h, ...pracasPadrao(txt) };
const [a, b] = cards.map((c) => parseCardPadrao(c, ctx));
assert.equal(a.fonte_id, 'gestao_fidalgoleiloes_87678');
assert.equal(a.cidade, 'São Paulo');
assert.equal(a.estado, 'SP');
assert.equal(a.bairro, 'Santo Amaro');
assert.equal(a.valor_minimo, 1400000);
assert.equal(a.numero_matricula, '285.648');
assert.equal(a.tipo, 'apartamento');
assert.match(a.titulo, /^Apartamento nº191/);
assert.equal(a.link_foto, 'https://www.fidalgoleiloes.com.br/sishp/leilao/3766/fotos/87678_01.jpg');
assert.equal(b.bairro, 'Butantã');
assert.equal(b.valor_minimo, 1100000);
// Card de outra categoria (veículo) não vira imóvel.
assert.equal(parseCardPadrao({ ...cards[0], html: cards[0].html.replace('IMÓVEL:', 'VEÍCULO:') }, ctx), null);
console.log('ok — gestão grátis: acento reconstruído, Fidalgo 2/2 lotes do evento 3766 (layout lotePadrao), praças pelo encerramento');
