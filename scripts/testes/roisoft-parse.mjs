// PLATAFORMA ROISOFT (26/10). Fixtures REAIS lidas pelo runner do GitHub (recon grátis) — o banco leva 403:
//   • roisoft-leiloesbrasil-catalogo-pag1.json — POST /lotes/listar-imoveis-dados pág. 1: total 61, 20 por página.
//   • roisoft-caiapo-catalogo.json             — idem Caiapó (molde em cards): total 4.
//   • roisoft-leiloesbrasil-lote-191542.html  — "Valor 1º L / 2º L", status "Não arrematado", edital /principal/6201.pdf.
//   • roisoft-caiapo-lote-7367.html            — "Lance Mínimo", "AVALIAÇÃO JUDICIAL", processo, 300 ha em Paranatinga/MT.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TENANTS, lerCatalogo, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow } from '../lib/roisoft-parse.mjs';
import { criarMotorRoisoft, COBERTURA_ROISOFT } from '../lib/motor/fetch-roisoft.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
assert.equal(new Set(Object.values(TENANTS).map((t) => t.fonte)).size, Object.keys(TENANTS).length, 'fonte duplicada');
assert.ok(!Object.values(TENANTS).some((t) => /norteleiloes/.test(t.base)), 'Norte saiu do molde (Next.js)');

const LB = TENANTS.leiloesbrasil.base, CA = TENANTS.caiapo.base;
const cLB = lerCatalogo(fx('roisoft-leiloesbrasil-catalogo-pag1.json'));
assert.deepEqual([cLB.total, cLB.porPagina, extrairUrlsDeLote(cLB.dados, LB).size], [61, 20, 20], 'tabela: 20 da página 1 de 61');
const cCA = lerCatalogo(fx('roisoft-caiapo-catalogo.json'));
const uCA = extrairUrlsDeLote(cCA.dados, CA);
assert.deepEqual([cCA.total, uCA.size], [4, 4], 'cards: 4 de 4 (completo)');
assert.equal(uCA.get('7367'), `${CA}/imoveis/lote/7367`);
assert.equal(idDaUrl(uCA.get('7367')), '7367');
assert.equal(lerCatalogo('<html>403</html>'), null, 'corpo que não é o JSON da plataforma não vira catálogo vazio');

const dLB = parseDetalhe(fx('roisoft-leiloesbrasil-lote-191542.html'), `${LB}/imoveis/lote/191542`);
assert.deepEqual([dLB.cidade, dLB.estado], ['Araguacu', 'TO']);
assert.equal(dLB.valor_avaliacao, 1200000);
assert.equal(dLB.valor_minimo, 714595.47);
assert.equal(dLB.data_leilao, '2026-10-26');
assert.equal(dLB.encerrado, false, '"Não arrematado" na 1ª praça não encerra (a data decide)');
assert.equal(dLB.link_edital, 'https://www.leiloesbrasil.com.br/principal/6201.pdf?v=87385');
assert.match(dLB.titulo, /^ARAGUACU\/TO - MISTO/);

const dCA = parseDetalhe(fx('roisoft-caiapo-lote-7367.html'), `${CA}/imoveis/lote/7367`);
assert.deepEqual([dCA.cidade, dCA.estado], ['Paranatinga', 'MT']);
assert.equal(dCA.valor_avaliacao, 8400000, 'AVALIAÇÃO JUDICIAL da descrição');
assert.equal(dCA.valor_minimo, 8400000, 'Lance Mínimo');
assert.equal(dCA.modalidade, 'judicial');
assert.equal(dCA.numero_processo, '0003023-77.2016.8.11.0044');
assert.equal(dCA.data_leilao, '2026-10-29');
assert.ok(dCA.link_edital?.endsWith('/principal/226.pdf?v=6940'));
assert.equal(montarRow(`${CA}/imoveis/lote/7367`, dCA, TENANTS.caiapo).fonte_id, 'caiapo_7367');
assert.equal(parseDetalhe('<html>login</html>', `${CA}/imoveis/lote/1`), null, 'página que não é o detalhe = "não li"');

// Transporte: catálogo inteiro (61 → 4 páginas) por POST; página que falha derruba a lista.
const pag = JSON.parse(fx('roisoft-leiloesbrasil-catalogo-pag1.json'));
const pagN = (n) => JSON.stringify({ ...pag, dados: pag.dados.replace(/data-rowid="(\d+)"/g, (m, id) => `data-rowid="${n}${id}"`) });
const posts = [];
globalThis.fetch = async (url, opts = {}) => {
  const p = new URLSearchParams(opts.body || '').get('pagina');
  posts.push(p);
  if (String(url).includes('falha.exemplo') && p === '3') return new Response('erro', { status: 500 });
  return new Response(p === '1' ? JSON.stringify(pag) : pagN(p), { status: 200, headers: { 'content-type': 'application/json' } });
};
const { fetchFonte } = criarMotorRoisoft();
const r = await fetchFonte('https://www.ok.exemplo/lotes/listar-imoveis-dados');
assert.equal(extrairUrlsDeLote(r.html, 'https://www.ok.exemplo').size, 80, '4 páginas × 20 (o site declara 61; a fixture repete a pág. 1)');
assert.deepEqual(posts, ['1', '2', '3', '4']);
assert.equal((await fetchFonte('https://www.ok.exemplo/lotes/listar-imoveis-dados?pagina=2')).html, r.html, '2ª chamada = mesma lista');
assert.equal(COBERTURA_ROISOFT.get('www.ok.exemplo').total, 61);
const rf = await criarMotorRoisoft().fetchFonte('https://www.falha.exemplo/lotes/listar-imoveis-dados');
assert.equal(rf.html, null);
assert.match(rf.via, /página 3\/4/);

console.log('ok — roisoft: catálogo por POST (tabela 61 / cards 4), detalhe Leilões Brasil e Caiapó, completude e falha que não vira lista parcial');
