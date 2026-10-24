// SUPORTE LEILÕES v2 (pendência 296, 24/10): Marco Antônio / Rodrigo Collyer / Anna Luiza / DCM saíram do template
// antigo da Suporte para um app Next.js — o lote vem no payload RSC (`initialLote`). Formas REAIS medidas pelo banco:
//  - 11083: página VERBATIM (pedaços reais do payload, cortando string no meio; descrição numa linha `2e:T10a3,`
//    sem quebra no fim; `"initialLote":null` antes, no layout). Conferido de cabeça na página: avaliação R$ 285.000,
//    1ª praça 03/11 14h R$ 285.000, 2ª 10/11 14h R$ 142.500, Presidente Olegário/MG, 17 fotos, edital + matrícula.
//  - os demais: o `initialLote` real remontado no formato do Next (fixtures/suportev2-pagina.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TENANTS, parseDetalhe, montarRow, checarQualidade, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, fluxoRsc, linhaDeTexto,
} from '../lib/suportev2-parse.mjs';
import { paginaRsc } from './fixtures/suportev2-pagina.mjs';

const T = TENANTS.marcoantonio;
const AGORA = new Date('2026-10-24T12:00:00-03:00');
const fx = JSON.parse(readFileSync(new URL('./fixtures/suportev2-lotes.json', import.meta.url), 'utf8')).lotes;
const det = (id, agora = AGORA) => parseDetalhe(paginaRsc(fx[id].lote, fx[id].textos), fx[id].url, { agora, tenant: T });

// (1) Página real, verbatim: fluxo picado, linha de texto pelo TAMANHO EM BYTES, o 1º initialLote que é objeto.
const real = readFileSync(new URL('./fixtures/suportev2-lote-11083.html', import.meta.url), 'utf8');
const desc = linhaDeTexto(fluxoRsc(real), '2e');
assert.equal(Buffer.byteLength(desc, 'utf8'), 0x10a3, 'a linha T termina no tamanho declarado, não numa quebra de linha');
assert.ok(desc.endsWith('<br></div>') && !desc.includes('1d:['), 'a descrição não engole a linha do lote que vem colada');
const d1 = parseDetalhe(real, 'https://marcoantonioleiloeiro.com.br/lotes/11083', { agora: AGORA, tenant: T });
assert.equal(d1.titulo, 'MASSA FALIDA DE EDMAR DE DEUS VIEIRA | LOJA COMERCIAL | MATERIAIS DE CONSTRUÇÃO | PRESIDENTE OLEGÁRIO/MG');
assert.deepEqual([d1.cidade, d1.estado], ['Presidente Olegário', 'MG']);
assert.deepEqual([d1.valor_avaliacao, d1.valor_minimo, d1.valor_minimo_2], [285000, 285000, 142500]);
assert.equal(d1.data_leilao, '2026-11-03');
assert.equal(d1.data_leilao_2, new Date('2026-11-10T14:00:00-03:00').toISOString());
assert.equal(d1.modalidade, 'judicial');
assert.equal(d1.tipo, 'comercial', 'categoria "Ponto Comercial" da própria fonte');
assert.equal(d1.area_m2, 159.04);
assert.equal(d1.numero_matricula, '12.415');
assert.equal(d1.numero_processo, '0026994-08.2005.8.13.05', 'processo já mascarado fica como veio');
assert.deepEqual(d1.anexos.map((a) => a.tipo), ['edital', 'matricula']);
assert.equal(d1.fotos.length, 17);
assert.ok(d1.link_foto.endsWith('sl-bem-9768-6acf8fa38960d-6acf8fa38a8c8.png'), 'capa = a imagem principal');
assert.equal(d1.encerrado, false);
assert.ok(!/<|&nbsp;|&quot;/.test(d1.descricao), 'descrição sem HTML nem entidade');

// (2) Praças: a vigente é a 1ª que não fechou. 10830 (3 praças, 1ª e 2ª vencidas): vale a 3ª, R$ 525 mil = o
//     `lanceInicialVigente` que o próprio site mostra; processo de 20 dígitos ganha a máscara CNJ.
const d2 = det('10830');
assert.deepEqual([d2.data_leilao, d2.valor_minimo, d2.valor_minimo_2, d2.data_leilao_2], ['2026-10-29', 525000, null, null]);
assert.equal(d2.numero_processo, '5773065-75.2009.8.13.0024');
assert.deepEqual([d2.cidade, d2.estado], ['Curitiba', 'PR']);
assert.equal(det('10830', new Date('2026-10-30T12:00:00-03:00')).encerrado, true, 'todas as praças vencidas = encerrado');
assert.deepEqual([det('10830', new Date('2026-10-10T12:00:00-03:00')).valor_minimo, det('10830', new Date('2026-10-10T12:00:00-03:00')).valor_minimo_2], [1750000, 875000]);

// (3) Cidade digitada à mão: "BH" → Belo Horizonte; "…, município de Santana do Riacho/MG" → Santana do Riacho;
//     "SANTA RITA IBITIPOCA" (sem o "de") → Santa Rita de Ibitipoca. Nada que o IBGE não conheça.
assert.equal(det('10989').cidade, 'Belo Horizonte');
assert.equal(det('11055').cidade, 'Santana do Riacho');
assert.equal(det('11086').cidade, 'Santa Rita de Ibitipoca');

// (4) Venda direta sem praça: lance da vitrine, sem data, aberta.
const d4 = det('10341');
assert.deepEqual([d4.modalidade, d4.valor_avaliacao, d4.valor_minimo, d4.data_leilao, d4.encerrado], ['venda_direta', 3000000, 1500000, null, false]);
assert.deepEqual([d4.cidade, d4.tipo, d4.area_m2], ['Santa Luzia', 'terreno', 4022.5]);
// Venda direta com praças de leilão ANTERIOR (10706: 16 e 30/09, "Disponível" em 24/10) continua à venda.
const vd = structuredClone(fx['10341'].lote);
Object.assign(vd.leilao, { data1: '2026-09-16T09:00:00-03:00', data2: '2026-09-30T09:00:00-03:00' });
assert.equal(parseDetalhe(paginaRsc(vd, fx['10341'].textos), fx['10341'].url, { agora: AGORA, tenant: T }).encerrado, false);

// (5) Leiloeiro pelo `leilao.sites`: publicado nas 4 vitrines → o dono do banco; só na do Rodrigo → Rodrigo, com a URL
//     da vitrine dele. Um banco, uma fonte: o mesmo lote nunca vira duas linhas (antes: sl_marcoantonio… e sl_rodrigo…).
const r4 = montarRow(fx['10341'].url, d4, T);
assert.deepEqual([r4.fonte, r4.fonte_id, r4.leiloeiro, r4.url_lote], ['MARCOANTONIO', 'marcoantonio_10341', 'Marco Antônio Leiloeiro', 'https://marcoantonioleiloeiro.com.br/lotes/10341']);
const d5 = det('11086');
const r5 = montarRow(fx['11086'].url, d5, T);
assert.deepEqual([r5.leiloeiro, r5.url_lote, r5.fonte_id], ['Rodrigo Collyer Leilões', 'https://www.rodrigoleiloeiro.com.br/lotes/11086', 'marcoantonio_11086']);

// (6) O tipo do bem dito pela FONTE decide: equipamento e veículo saem como fora_do_acervo (permanente), sem a chave
//     auxiliar vazar para o upsert; imóvel passa.
const q5 = checarQualidade(r5, { estrito: false });
assert.deepEqual([q5.descartar, q5.faltando], [true, ['fora_do_acervo']]);
assert.ok(!Object.keys(r5).includes('_tipoBem'), '_tipoBem não é coluna');
assert.equal(checarQualidade(montarRow(fx['11073'].url, det('11073'), T), { estrito: false }).faltando[0], 'fora_do_acervo');
const r1 = montarRow('https://marcoantonioleiloeiro.com.br/lotes/11055', det('11055'), T);
assert.equal(checarQualidade(r1, { estrito: false }).descartar, false);
assert.deepEqual([r1.tipo, r1.modalidade, r1.valor_minimo, r1.desconto_percentual, r1.fotos.length], ['terreno', 'judicial', 225000, 10, 2]);

// (7) Veículo: placa/chassi/renavam ficam na descrição (é dela que lib/veiculo-do-lote.mjs lê).
assert.ok(/PLACA HOA1D44/.test(det('11073').descricao));

// (8) Página sem lote (layout com initialLote:null, ou HTML que não é do Next) = null, nunca lote vazio.
assert.equal(parseDetalhe('<script>self.__next_f.push([1,"2:[\\"$\\",\\"$L1b\\",null,{\\"initialLote\\":null}]\\n"])</script>', 'https://x/lotes/1', { agora: AGORA }), null);
assert.equal(parseDetalhe('<html><article class="lote-main"></article></html>', 'https://x/lotes/1', { agora: AGORA }), null);

// (9) Catálogo: /lotes/<id> da vitrine; o lote que o dono e um irmão listam fica com a URL do 1º que listou. O nível 2
//     segue o CANÔNICO da página (imóveis → imóveis dos irmãos; veículos → veículos), e vitrine irmã não reabre irmãos.
const cat = (base, caminho, ids) => `<link rel="canonical" href="${base}${caminho}"/>${ids.map((i) => `<a href="/lotes/${i}">x</a>`).join('')}`;
const u1 = extrairUrlsDeLote(cat(T.base, '/leiloes-de/imoveis', [10341, 11083]), T.base);
assert.deepEqual([...u1.keys()], ['10341', '11083']);
const u2 = extrairUrlsDeLote(cat('https://www.rodrigoleiloeiro.com.br', '/leiloes-de/imoveis', [10341, 99001]), 'https://www.rodrigoleiloeiro.com.br');
assert.equal(u2.get('10341'), 'https://marcoantonioleiloeiro.com.br/lotes/10341');
assert.equal(u2.get('99001'), 'https://www.rodrigoleiloeiro.com.br/lotes/99001');
assert.equal(idDaUrl('https://www.dcmleiloes.com.br/lotes/10818'), '10818');
assert.deepEqual([...extrairUrlsDeEvento(cat(T.base, '/leiloes-de/veiculos', []), T.base).values()], [
  'https://www.rodrigoleiloeiro.com.br/leiloes-de/veiculos', 'https://www.annaluizaleiloeira.com.br/leiloes-de/veiculos', 'https://www.dcmleiloes.com.br/leiloes-de/veiculos']);
assert.equal(extrairUrlsDeEvento(cat('https://www.rodrigoleiloeiro.com.br', '/leiloes-de/imoveis', []), 'https://www.rodrigoleiloeiro.com.br').size, 0);
assert.equal(extrairUrlsDeEvento('<html></html>', T.base).size, 0, 'sem canônico, sem nível 2');

console.log('✓ suportev2: payload RSC → linha (página real 11083 + 6 lotes reais remontados)');
