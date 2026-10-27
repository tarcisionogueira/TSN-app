// LOJAS SUPERBID EXCHANGE (27/10). Fixture REAL lida pelo banco (json_pedir) em 27/10:
//   • sbidloja-cs-16290-imoveis.json — CS LEILÕES (storeId 16290, do siteconfig de csleiloes.com.br), modo loja + filtro
//     imóveis: 1 oferta (5067722, terreno em São José/SC, 1ª praça R$ 82.000 em 12/11, 2ª R$ 41.000 em 19/11) — publicada
//     em 25/10 e ainda fora do portal SUPERBID no acervo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TENANTS, extrairUrlsDeLote, detalhesDoCatalogo, totalDoCatalogo, idDaUrl, montarRow, lerCatalogo } from '../lib/sbidloja-parse.mjs';
import { ofertasNoPortal } from '../lib/motor/fetch-sbidloja.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ts = Object.values(TENANTS);
assert.equal(ts.length, 32, '32 lojas com storeId no siteconfig');
assert.equal(new Set(ts.map((t) => t.fonte)).size, ts.length, 'fonte duplicada');
assert.equal(new Set(ts.map((t) => t.storeId)).size, ts.length, 'storeId duplicado');
assert.ok(ts.every((t) => t.catalogo.includes(`stores.id:${t.storeId};`) && /requestOrigin=store/.test(t.catalogo) && /portalId=\[2,15\]/.test(t.catalogo)), 'modo loja exige portalId=[2,15] + requestOrigin=store');

// O motor anota a loja e o que tirou por já vir pelo portal; aqui, como ele devolve.
const cru = JSON.parse(fx('sbidloja-cs-16290-imoveis.json'));
const txt = JSON.stringify({ total: cru.total, _storeId: '16290', _noPortal: 0, offers: cru.offers });
const urls = extrairUrlsDeLote(txt);
assert.deepEqual([...urls.entries()], [['5067722', 'https://www.csleiloes.com.br/oferta/5067722']]);
assert.equal(idDaUrl('https://www.csleiloes.com.br/oferta/5067722'), '5067722');
assert.equal(idDaUrl('https://www.superbid.net/oferta/terreno-em-sao-jose-5067722'), '5067722');
assert.equal(totalDoCatalogo(txt), 1);
assert.equal(totalDoCatalogo(JSON.stringify({ total: 40, _noPortal: 38, offers: [] })), 2, 'o que o portal já trouxe sai da conta');
assert.equal(lerCatalogo('<html>403</html>'), null, 'corpo que não é o JSON da API não vira catálogo vazio');

const det = detalhesDoCatalogo(txt).get('https://www.csleiloes.com.br/oferta/5067722');
assert.deepEqual([det.cidade, det.estado, det.valor_minimo, det.valor_avaliacao], ['São José', 'SC', 82000, 82000]);
assert.deepEqual([det.data_leilao, det.data_leilao_2, det.valor_minimo_2], ['2026-11-12', '2026-11-19T14:00:00-03:00', 41000]);
assert.equal(det.modalidade, 'judicial');
assert.equal(det.numero_processo, '5012023-85.2019.8.24.0064');
assert.equal(det.encerrado, false);
assert.ok(det.link_foto && det.fotos.length >= 1);
assert.equal(detalhesDoCatalogo(txt, Date.parse('2026-11-20')).size, 1);
const vencido = JSON.parse(txt).offers[0];
assert.equal((await import('../lib/sbidloja-parse.mjs')).detalheDaOferta(vencido, Date.parse('2026-11-13T12:00:00-03:00')).encerrado, true, 'praça vencida = encerrado');

const row = montarRow('https://www.csleiloes.com.br/oferta/5067722', det, TENANTS.cs);
assert.deepEqual([row.fonte, row.fonte_id, row.leiloeiro, row.url_lote], ['SBL_CS', 'sbl_cs_5067722', 'CS LEILÕES', 'https://www.csleiloes.com.br/oferta/5067722']);
assert.equal(row.tipo, 'terreno');

// Dedup com o portal: lê imoveis_leilao; falha de leitura = null (o motor então NÃO grava).
process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_KEY = 'k';
let pedido = '';
const s = await ofertasNoPortal(['1', '2'], { fetchFn: async (u) => { pedido = u; return { ok: true, json: async () => [{ fonte_id: 'sbid_1' }] }; } });
assert.deepEqual([...s], ['1']);
assert.match(pedido, /fonte_id=in\.\(sbid_1,sold_1,dilson_1,kron_1,jmf_1,totall_1,crep_1,sbid_2,/);
assert.match(pedido, /ativo=eq\.true/);
assert.equal(await ofertasNoPortal(['1'], { fetchFn: async () => ({ ok: false }) }), null);
console.log('sbidloja-parse: ok');
