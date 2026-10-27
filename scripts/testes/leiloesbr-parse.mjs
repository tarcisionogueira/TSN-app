// PLATAFORMA LEILÕESBR (27/10). Fixtures REAIS lidas pelo banco (pg_net, GET "pelado" — o IIS dá 400 a cabeçalho de
// navegador) em 27/10:
//   • leiloesbr-marciopinho-listacatalogo-v7.html — molde V7: 5 catálogos próprios + 2 de parceiro em andamento, antes de
//     "Leilões finalizados" (os finalizados vêm na mesma página e NÃO entram).
//   • leiloesbr-budano-listacatalogo-v8.html      — molde V8: `listacatalogoData` com 9 leilões (5 em sites parceiros).
//   • leiloesbr-dupla-listacatalogo-v8-vazia.html — V8 sem leilão ativo ("Nenhum leilão ativo foi encontrado").
//   • leiloesbr-rf-catalogo-66486.html            — catálogo V7 (recortado): "222 Itens encontrados", 33 tipos somando 222.
//   • leiloesbr-mundoemartes-65893-{tipos,total}.json — AJAX do catálogo V8: 18 tipos somando 222, TOTAL 222.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, numerosDoCatalogo, totalDoEvento, tipoEhAlvo, dadosListaV8,
  marcarTenant, COBERTURA_LEILOESBR, tabelaCoberturaLeiloesBr,
} from '../lib/leiloesbr-parse.mjs';
import { numerosV8 } from '../lib/motor/fetch-leiloesbr.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
assert.equal(new Set(Object.values(TENANTS).map((t) => t.fonte)).size, Object.keys(TENANTS).length, 'fonte duplicada');
assert.equal(Object.keys(TENANTS).length, 44, '44 domínios LEILOESBR da junta');
assert.ok(Object.values(TENANTS).every((t) => /^https:\/\/[a-z0-9.-]+$/.test(t.base)), 'base sem barra final');

// V7: só os ativos; parceiro (outro domínio da plataforma) entra, com https.
const MP = TENANTS.marciopinho.base;
const ev7 = extrairUrlsDeEvento(fx('leiloesbr-marciopinho-listacatalogo-v7.html'), MP);
assert.deepEqual([...ev7.keys()].sort(), ['65245', '65565', '65796', '65797', '65969', '66229', '66636']);
assert.equal(ev7.get('66229'), `${MP}/catalogo.asp?Num=66229`);
assert.equal(ev7.get('66636'), 'https://www.bonequinhadeluxoleiloes.com.br/catalogo.asp?Num=66636');
assert.ok(!ev7.has('65852'), 'finalizado (CXX Younes, 21/10) não é catálogo ativo');

// V8: JSON inline; o de parceiro vai para o site do parceiro.
const BU = TENANTS.budano.base;
const ev8 = extrairUrlsDeEvento(fx('leiloesbr-budano-listacatalogo-v8.html'), BU);
assert.equal(ev8.size, 9);
assert.equal(ev8.get('65893'), 'https://www.mundoemartes.com.br/catalogo.asp?Num=65893');
assert.equal(ev8.get('66453'), 'https://www.budanoleiloeiro.com.br/catalogo.asp?Num=66453');
const vazia = fx('leiloesbr-dupla-listacatalogo-v8-vazia.html');
assert.equal(dadosListaV8(vazia).MENSAGEM_ERRO, 'Nenhum leilão ativo foi encontrado');
assert.equal(extrairUrlsDeEvento(vazia, TENANTS.dupla.base).size, 0, 'V8 sem leilão ativo = zero catálogos (declarado)');

// Catálogo V7: total declarado × contagem por tipo; nenhum tipo é imóvel/veículo.
marcarTenant('www.rfleiloes.com.br', 'ok');
const rf = numerosDoCatalogo(fx('leiloesbr-rf-catalogo-66486.html'));
assert.deepEqual([rf.num, rf.molde, rf.declarados, rf.tipos.length, rf.tipados, rf.alvoN], ['66486', 'V7', 222, 33, 222, 0]);
assert.equal(totalDoEvento(fx('leiloesbr-rf-catalogo-66486.html')), 0, '100% tipado e nenhum tipo-alvo: ausência provada');
assert.equal(extrairUrlsDeLote(fx('leiloesbr-rf-catalogo-66486.html')).size, 0);
assert.equal(numerosDoCatalogo('<html>Bad Request</html>'), null, 'página que não é catálogo não vira zero');
assert.match(tabelaCoberturaLeiloesBr(), /www\.rfleiloes\.com\.br \| ok \| 1 \| 222 \| 222 \| 100% \| 0 \| ok/);
marcarTenant('teste.invalid', 'ok');

// Catálogo V8: o motor junta tiposload + contentload (aqui servidos das fixtures).
const servir = async (u) => ({ corpo: /tiposload/.test(u) ? fx('leiloesbr-mundoemartes-65893-tipos.json') : fx('leiloesbr-mundoemartes-65893-total.json') });
const n8 = await numerosV8('https://www.mundoemartes.com.br', '65893', servir);
assert.deepEqual([n8.total, n8.tipos.length], [222, 18]);
const html8 = `<html>carregaTipos</html>\n<!--LBR-NUMEROS ${JSON.stringify(n8)}-->`;
const c8 = numerosDoCatalogo(html8);
assert.deepEqual([c8.num, c8.molde, c8.declarados, c8.tipados, c8.alvoN], ['65893', 'V8', 222, 222, 0]);
// V8 sem tipo nenhum ("Nenhum tipo foi encontrado") com TOTAL 0 = catálogo vazio; com TOTAL > 0 = ausência NÃO provada.
const vazioTipos = async (u) => ({ corpo: /tiposload/.test(u) ? fx('leiloesbr-sb302-58383-tipos-vazio.json') : '{"TOTAL":"0" }' });
const n0 = await numerosV8('https://www.sbleiloeiro302.com.br', '58383', vazioTipos);
assert.equal(totalDoEvento(`<!--LBR-NUMEROS ${JSON.stringify(n0)}-->`), 0);
const semTipo = await numerosV8('https://x.com.br', '1', async (u) => ({ corpo: /tiposload/.test(u) ? fx('leiloesbr-sb302-58383-tipos-vazio.json') : '{"TOTAL":"40" }' }));
assert.equal(totalDoEvento(`<!--LBR-NUMEROS ${JSON.stringify(semTipo)}-->`), 40, '40 peças sem tipo: o runner vê 0 de 40 e corta a lista');
assert.ok((await numerosV8('https://x.com.br', '1', async () => ({ corpo: null, motivo: 'HTTP 500' }))).erro, 'AJAX que falha é erro, não zero');

// Tipo-alvo: imóvel/veículo sim; memorabilia de carro não.
assert.ok(tipoEhAlvo('Imóveis') && tipoEhAlvo('Veículos') && tipoEhAlvo('Terrenos'));
assert.ok(!tipoEhAlvo('Itens automobilísticos') && !tipoEhAlvo('Automodelismo') && !tipoEhAlvo('Máquinas e Motores') && !tipoEhAlvo('Quadros'));
const comImovel = numerosDoCatalogo('<span class="find-numb">10</span><label for="tipo9"><input type="checkbox"> Imóveis (2)</label><label for="tipo1"><input type="checkbox"> Quadros (8)</label> catalogo.asp?Num=1');
assert.deepEqual([comImovel.alvoN, comImovel.tipados], [2, 10], 'tipo de imóvel declarado vira candidato (o runner corta a lista: 0 de 2)');

assert.ok(COBERTURA_LEILOESBR.get('www.rfleiloes.com.br').catalogos.has('66486'));
assert.match(tabelaCoberturaLeiloesBr(), /teste\.invalid \| ok \| \d+ \| \d+ \| \d+ \| \d+% \| \d+ \| VER/, 'tenant com peça sem tipo / tipo-alvo pede revisão');
console.log('leiloesbr-parse: ok');
