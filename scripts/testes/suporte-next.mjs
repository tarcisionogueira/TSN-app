// FRONTS NOVOS DA SUPORTE (26/10): LanceVIP, VIX, Portal dos Leilões (Next.js, SSR) e o front clássico /categoria/
// (Simões, VJ, Marco Aurélio). Fixtures = páginas REAIS baixadas pelo banco (pg_net) em 26/10, sem <script>/<svg>/<style>
// (o Portal guarda o payload RSC, de onde sai o painel do lote). Conferido de cabeça nas páginas:
//  - lancevip 2764-1: apto 405, Colombo/PR, 1ª praça 04/12/2026 10h R$ 230.000, 2ª 14/12 R$ 138.000, processo
//    0006799-07.2024.8.16.0193, matrícula 74585, edital + matrícula;
//  - vix 18257: apto Condomínio Mônica Bloco B, Serra/ES, R$ 751.740 (= avaliação), encerra 04/11/2026 10h, 3 fotos.
// E a CONFERÊNCIA DE COBERTURA (lição do FREITAS): o enumerado contra o total que o próprio site declara, pelo
// `enumerar` REAL do motor sobre um fetch de mentira que serve as fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANCEVIP, VIX, PORTAL, dataBR, cidadeDoTexto, tituloVeiculo } from '../lib/suporte-next-parse.mjs';
import * as CL from '../lib/suporte-classico-parse.mjs';
import { enumerar } from '../lib/motor/runner.mjs';
import cfgLancevip from '../lib/motor/fontes/lancevip.mjs';
import cfgVix from '../lib/motor/fontes/vixleiloes.mjs';
import cfgPortal from '../lib/motor/fontes/portaldosleiloes.mjs';
import cfgClassico from '../lib/motor/fontes/suporteclassico.mjs';
import { veiculoDoLote } from '../lib/veiculo-do-lote.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/suporte-next/${n}`, import.meta.url), 'utf8');
const AGORA = new Date('2026-10-26T15:00:00-03:00');
// fetch de mentira: URL → fixture; o que não está no mapa "não abriu" (como o motor recebe uma falha de rede).
const fetchDe = (mapa) => async (url) => (mapa[url] ? { html: fx(mapa[url]), via: 'direto' } : { html: null, via: 'falhou' });
const silencioso = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

// ── utilidades ───────────────────────────────────────────────────────────────────────────────────
assert.equal(dataBR('04/12/2026 10:00'), '2026-12-04T10:00:00-03:00');
assert.equal(dataBR('04/11/2026, 10:00'), '2026-11-04T10:00:00-03:00');
assert.equal(dataBR('31/12/2026'), '2026-12-31T00:00:00-03:00');
assert.deepEqual(cidadeDoTexto('Terreno 02/F, 366,68 m², Ariquemes/RO — matrícula 9.401'), { cidade: 'Ariquemes', estado: 'RO' });

// ══ LANCEVIP ═════════════════════════════════════════════════════════════════════════════════════
{
  const T = LANCEVIP.TENANTS.lancevip;
  const B = T.base;
  // Cobertura: "Exibindo 1–12 de 26" — 3 páginas, 26 de 26.
  const cat = `${B}/lotes?subcategoria=15,16,17,18,20`;
  const mapa = { [cat]: 'lancevip-imoveis-p1.html', [`${cat}&page=2`]: 'lancevip-imoveis-p2.html', [`${cat}&page=3`]: 'lancevip-imoveis-p3.html' };
  const en = await silencioso(() => enumerar(fetchDe(mapa), T, { ...cfgLancevip, parse: cfgLancevip.parse }, { maxPages: cfgLancevip.maxPages, semBD: true }));
  assert.equal(LANCEVIP.totalDoCatalogo(fx('lancevip-imoveis-p1.html')), 26);
  assert.equal(en.urls.length, 26, 'os 26 imóveis que o site declara');
  assert.equal(en.completa, true);
  assert.equal(en.cortada, null);
  // Página 2 que NÃO abre: a lista sai cortada (o motor não varre sumidos sobre ela) — antes era "fim do catálogo".
  const so1 = await silencioso(() => enumerar(fetchDe({ [cat]: 'lancevip-imoveis-p1.html' }), T, cfgLancevip, { maxPages: 8, semBD: true }));
  assert.equal(so1.urls.length, 12);
  assert.equal(so1.completa, false, 'página seguinte que não abriu = lista incompleta');
  assert.match(so1.cortada, /página 2 do catálogo não abriu/);

  // Veículos: 13 de 13, com o lote avulso `/lote/35683` (id `ref35683`) no meio dos `/leilao/N/lote/N`.
  const v1 = LANCEVIP.extrairUrlsDeLote(fx('lancevip-veiculos-p1.html'), B);
  const v2 = LANCEVIP.extrairUrlsDeLote(fx('lancevip-veiculos-p2.html'), B);
  assert.equal(LANCEVIP.totalDoCatalogo(fx('lancevip-veiculos-p1.html')), 13);
  assert.equal(new Set([...v1.keys(), ...v2.keys()]).size, 13);
  assert.ok(v1.has('ref35683') && v1.get('ref35683') === `${B}/lote/35683`);
  assert.equal(LANCEVIP.idDaUrl(`${B}/lote/35683`), 'ref35683');
  assert.equal(LANCEVIP.idDaUrl(`${B}/leilao/2764/lote/1`), '2764-1');

  const det = (n, u) => LANCEVIP.parseDetalhe(fx(n), u, { agora: AGORA });
  const d = det('lancevip-lote-2764-1.html', `${B}/leilao/2764/lote/1`);
  assert.equal(d.titulo, 'Apartamento 405 — Condomínio Residencial Bougainville — Colombo/PR');
  assert.deepEqual([d.cidade, d.estado, d.tipo, d.modalidade], ['Colombo', 'PR', 'apartamento', 'judicial']);
  assert.deepEqual([d.valor_avaliacao, d.valor_minimo, d.valor_minimo_2], [230000, 230000, 138000]);
  assert.equal(d.data_leilao, '2026-12-04');
  assert.equal(d.data_leilao_2, new Date('2026-12-14T10:00:00-03:00').toISOString());
  assert.deepEqual([d.numero_processo, d.numero_matricula, d.area_m2], ['0006799-07.2024.8.16.0193', '74585', 53.66]);
  assert.deepEqual(d.anexos.map((a) => a.tipo), ['edital', 'matricula']);
  assert.equal(d.encerrado, false);
  // Depois da 1ª praça vale a 2ª; depois da 2ª, encerrado.
  const d2 = LANCEVIP.parseDetalhe(fx('lancevip-lote-2764-1.html'), `${B}/leilao/2764/lote/1`, { agora: new Date('2026-12-05T12:00:00-03:00') });
  assert.deepEqual([d2.data_leilao, d2.valor_minimo, d2.valor_minimo_2], ['2026-12-14', 138000, null]);
  assert.equal(LANCEVIP.parseDetalhe(fx('lancevip-lote-2764-1.html'), `${B}/leilao/2764/lote/1`, { agora: new Date('2026-12-15T12:00:00-03:00') }).encerrado, true);

  // Venda direta (2691-1): preço de venda, sem praça, segue à venda com o prazo de proposta já vencido (o site diz
  // "ABERTO PARA LANCES") — sem data inventada.
  const vd = det('lancevip-lote-2691-1.html', `${B}/leilao/2691/lote/1`);
  assert.deepEqual([vd.modalidade, vd.valor_minimo, vd.data_leilao, vd.encerrado], ['venda_direta', 45000, null, false]);
  assert.deepEqual([vd.cidade, vd.estado, vd.tipo, vd.area_m2, vd.numero_matricula], ['São Miguel do Guaporé', 'RO', 'terreno', 150.4, '10167']);
  // "Matrícula" com o código INTERNO do comitente (ALVO-SICOOB-…) não é matrícula: vale a do título.
  const t2 = det('lancevip-lote-2760-2.html', `${B}/leilao/2760/lote/2`);
  assert.equal(t2.numero_matricula, '9.401');
  assert.deepEqual([t2.modalidade, t2.valor_minimo, t2.valor_minimo_2], ['extrajudicial', 74000, 60126.93]);
  const casa = det('lancevip-lote-2762-1.html', `${B}/leilao/2762/lote/1`);
  assert.deepEqual([casa.cidade, casa.estado, casa.tipo], ['Sarandi', 'PR', 'casa']);
  assert.ok(casa.link_foto.includes('/lancevipcombr/bens/35415/'));

  const row = LANCEVIP.montarRow(`${B}/leilao/2764/lote/1`, d, T);
  assert.equal(row.fonte_id, 'lancevip_2764-1');
  assert.equal(row.fonte, 'LANCEVIP');
  assert.equal(LANCEVIP.checarQualidade(row, { estrito: false }).descartar, false);
  // Moto (categoria "Motos"): o imóvel não a grava; o coletor de veículos lê a mesma página.
  const moto = det('lancevip-lote-ref35683.html', `${B}/lote/35683`);
  assert.deepEqual([moto.eh_imovel, moto.valor_minimo, moto.data_leilao, moto.numero_processo], [false, 12200, '2026-11-09', '7000213-07.2024.8.22.0017']);
  const q = LANCEVIP.checarQualidade(LANCEVIP.montarRow(`${B}/lote/35683`, moto, T), { estrito: false });
  assert.deepEqual([q.descartar, q.faltando], [true, ['fora_do_acervo']]);
}

// ══ VIX ══════════════════════════════════════════════════════════════════════════════════════════
{
  const T = VIX.TENANTS.vix;
  const B = T.base;
  // Agenda: 3 eventos abertos na página 1 (Iconha 27, CBMES 80, Apto Mônica 1); o externo (esleiloes) e os encerrados
  // ficam fora; a página 2 não tem evento aberto.
  const ev = [...VIX.extrairUrlsDeEvento(fx('vix-agenda-p1.html'), B).values()];
  assert.deepEqual(ev, [`${B}/leiloes/380-leilao-prefeitura-municipal-de-iconha`,
    `${B}/leiloes/379-leilao-01-2026-corpo-de-bombeiros-militar-espirito-santo-cbmes`, `${B}/leiloes/378-aprt-condominio-monica-bloco-b-serra`]);
  assert.equal(VIX.extrairUrlsDeEvento(fx('vix-agenda-p2.html'), B).size, 0);
  // Evento: o catálogo devolve TODOS os lotes (o imóvel pode estar na página 3) e `urlCandidata` separa.
  const cbmes = VIX.extrairUrlsDeLote(fx('vix-evento-379-p1.html'), B);
  assert.equal(cbmes.size, 24);
  assert.equal(VIX.totalDoEvento(fx('vix-evento-379-p1.html')), 80);
  assert.equal([...cbmes.values()].filter(VIX.urlCandidata).length, 0, 'nenhum imóvel na 1ª página do CBMES');
  assert.equal([...cbmes.values()].filter(cfgVix.veiculos.urlCandidata).length, 22, '22 veículos (2 sucatas fora)');
  const apto = VIX.extrairUrlsDeLote(fx('vix-evento-378.html'), B);
  assert.deepEqual([...apto.values()].filter(VIX.urlCandidata), [`${B}/lote/18257-aprt-condominio-monica-bloco-b-serra`]);

  // Cobertura pelo motor: a agenda + os 3 eventos; as páginas 2–4 do CBMES e a 2 da Iconha "não abrem" aqui →
  // 49 lotes de 108 declarados e a lista sai CORTADA (protege o acervo da varredura).
  const mapa = {
    [`${B}/leiloes`]: 'vix-agenda-p1.html', [`${B}/leiloes?page=2`]: 'vix-agenda-p2.html',
    [ev[0]]: 'vix-evento-380-p1.html', [ev[1]]: 'vix-evento-379-p1.html', [ev[2]]: 'vix-evento-378.html',
  };
  const en = await silencioso(() => enumerar(fetchDe(mapa), T, cfgVix, { maxPages: cfgVix.maxPages, semBD: true }));
  assert.equal(en.eventosCount, 3);
  assert.equal(en.urls.length, 24 + 24 + 1);
  assert.equal(en.completa, false);
  assert.match(en.cortada, /não abriu|declarados/);
  // Com o evento inteiro lido (o de lote único), a lista é completa.
  const so378 = await silencioso(() => enumerar(fetchDe({ [`${B}/leiloes`]: 'vix-agenda-p2.html', [`${B}/leiloes?page=2`]: 'vix-agenda-p2.html', [ev[2]]: 'vix-evento-378.html' }), T,
    { ...cfgVix, parse: { ...cfgVix.parse, extrairUrlsDeEvento: () => new Map([['378', ev[2]]]) } }, { maxPages: 3, semBD: true }));
  assert.deepEqual([so378.urls.length, so378.completa], [1, true]);

  const d = VIX.parseDetalhe(fx('vix-lote-18257.html'), `${B}/lote/18257-aprt-condominio-monica-bloco-b-serra`, { agora: AGORA });
  assert.deepEqual([d.titulo, d.cidade, d.estado, d.tipo, d.modalidade], ['Aprt Condomínio Mônica Bloco B, Serra', 'Serra', 'ES', 'apartamento', 'judicial']);
  assert.deepEqual([d.valor_avaliacao, d.valor_minimo, d.data_leilao], [751740, 751740, '2026-11-04']);
  assert.deepEqual([d.cep, d.bairro, d.numero_matricula, d.numero_processo], ['26164050', 'Jardim Limoeiro', '53.270', '0012052-79.2008.8.08.0024']);
  assert.equal(d.fotos.length, 3);
  assert.equal(d.anexos[0].tipo, 'edital');
  assert.equal(d.encerrado, false);
  assert.equal(VIX.parseDetalhe(fx('vix-lote-18257.html'), `${B}/lote/18257-x`, { agora: new Date('2026-11-05T12:00:00-03:00') }).encerrado, true);
  const row = VIX.montarRow(`${B}/lote/18257-aprt-condominio-monica-bloco-b-serra`, d, T);
  assert.equal(row.fonte_id, 'vixleiloes_18257');
  assert.equal(VIX.checarQualidade(row, { estrito: false }).ok, true);
  // Caminhão do CBMES: a fonte diz "Caminhão" — fora do acervo de imóveis, ficha (placa/chassi) para o de veículos.
  const cam = VIX.parseDetalhe(fx('vix-lote-18258.html'), `${B}/lote/18258-ford-cargo-1933-ano-2014-2014`, { agora: AGORA });
  assert.deepEqual([cam.eh_imovel, cam.cidade, cam.estado, cam.valor_minimo, cam.modalidade], [false, 'Vila Velha', 'ES', 59000, 'extrajudicial']);
  assert.match(cam.descricao, /PLACA: OYK5056/);
  // O tipo do veículo sai do título: a categoria da página vira prefixo quando o título não diz.
  assert.equal(tituloVeiculo(fx('vix-lote-18258.html')), 'Caminhão FORD/CARGO 1933, ANO: 2014/2014');
  assert.equal(tituloVeiculo(fx('lancevip-lote-ref35683.html')), 'Moto HONDA/NXR150 BROS ESD — 2011/2011');
}

// ══ PORTAL DOS LEILÕES ═══════════════════════════════════════════════════════════════════════════
{
  const T = PORTAL.TENANTS.portal;
  const B = T.base;
  // O filtro de imóveis do PRÓPRIO site: "Nenhum lote encontrado" → zero declarado (motivo "site declara…").
  const en = await silencioso(() => enumerar(fetchDe({ [`${B}/lotes?categoria=Im%C3%B3veis`]: 'portal-imoveis.html' }), T, cfgPortal, { maxPages: 6, semBD: true }));
  assert.deepEqual([en.urls.length, en.fetchOk, en.vazioDeclarado], [0, true, true]);
  // Catálogo que não abre NÃO é vazio declarado (é "não consegui ver").
  const fora = await silencioso(() => enumerar(fetchDe({}), T, cfgPortal, { maxPages: 6, semBD: true }));
  assert.deepEqual([fora.fetchOk, fora.vazioDeclarado], [false, false]);
  const d = PORTAL.parseDetalhe(fx('portal-lote-caminhao.html'), `${B}/lote/caminhao-cavalo-mecanico-internacional-pro-sleeper`, { agora: AGORA });
  assert.deepEqual([d.titulo, d.modalidade, d.valor_minimo, d.valor_avaliacao, d.data_leilao], ['Caminhão Cavalo Mecanico Internacional Pro sleeper', 'venda_direta', 130000, 130000, '2026-12-31']);
  assert.equal(d.fotos.length, 4);
  assert.equal(d.eh_imovel, false, 'tipo "Diversos" não é imóvel');
  assert.equal(PORTAL.idDaUrl(`${B}/lote/caminhao-cavalo-mecanico-internacional-pro-sleeper`), 'caminhao-cavalo-mecanico-internacional-pro-sleeper');

  // ── VEÍCULOS: só lote ABERTO, pelos leilões que o site declara abertos (o mesmo cfgV de scraper-veiculos-motor) ──
  const v = cfgPortal.veiculos;
  const cfgV = { ...cfgPortal, maxPages: v.maxPages, maxPagesEvento: v.maxPagesEvento,
    parse: { ...cfgPortal.parse, extrairUrlsDeLote: v.extrairUrlsDeLote, extrairUrlsDeEvento: v.extrairUrlsDeEvento } };
  assert.deepEqual(v.catalogos, ['/leiloes?situacao=andamento', '/leiloes?situacao=proximos']);
  // O card ENCERRADO da agenda fica fora; "Aberto para lances" e "Em breve" entram.
  assert.deepEqual([...PORTAL.eventosAbertos(fx('portal-leiloes-proximos.html'), B).keys()], ['54']);
  const E28 = `${B}/leilao/28-venda-direta-portal-dos-leiloes-2026`, E54 = `${B}/leilao/54-grande-leilao-usina-porto-rico-2026`;
  const mapaV = { [`${B}/leiloes?situacao=andamento`]: 'portal-leiloes-andamento.html', [`${B}/leiloes?situacao=proximos`]: 'portal-leiloes-proximos.html',
    [E28]: 'portal-evento-28-p1.html', [`${E28}?page=2`]: 'portal-evento-28-p2.html', [`${E28}?page=3`]: 'portal-evento-28-p3.html', [E54]: 'portal-evento-54.html' };
  const lerVeiculos = async (mapa) => {
    v.cobertura.zerar();
    const urls = new Set(); let completa = true;
    for (const catalogo of v.catalogos) {
      const r = await silencioso(() => enumerar(fetchDe(mapa), { ...T, catalogo }, cfgV, { maxPages: cfgV.maxPages, semBD: true }));
      r.urls.forEach((u) => urls.add(u)); completa = completa && r.completa;
    }
    return { urls: [...urls], completa, cob: v.cobertura.medir() };
  };
  const ve = await lerVeiculos(mapaV);
  // 49 cards lidos nas 3 páginas do leilão 28 contra os "49 de 49" que ele declara; o 54 anuncia 101 e lista 0.
  assert.deepEqual([ve.cob.declarado, ve.cob.lidos, ve.cob.ocultos, ve.cob.pct, ve.completa], [49, 49, 101, 1, true]);
  const abertos = ve.urls.filter(v.urlCandidata).map((u) => PORTAL.idDaUrl(u));
  // 11 cards sem "Vendido"/"Sem Licitantes" — a moto, o caminhão, e máquinas/geradores (que veiculoDoLote descarta).
  assert.equal(abertos.length, 11);
  assert.ok(abertos.includes('harley-davidson-flhp-road-king-police') && abertos.includes('caminhao-cavalo-mecanico-internacional-pro-sleeper'));
  assert.ok(!abertos.includes('automovel-camionete-ford-ranger-limited-3-2'), 'Ranger "Vendido" não é lida');
  // Página 2 do evento que não abre: a cobertura cai (24 de 49) e a leitura é marcada cortada — o coletor NÃO grava.
  const corte = await lerVeiculos({ ...mapaV, [`${E28}?page=2`]: undefined });
  assert.equal(corte.completa, false);
  assert.ok(corte.cob.pct < 0.9, `cobertura ${corte.cob.lidos}/${corte.cob.declarado}`);
  // Detalhe: a moto (tipo "Motos" vira prefixo do título) e o caminhão viram veículo; data da praça futura.
  const uH = `${B}/lote/harley-davidson-flhp-road-king-police`;
  const dH = PORTAL.parseDetalhe(fx('portal-lote-harley.html'), uH, { agora: AGORA });
  assert.deepEqual([dH.valor_minimo, dH.valor_avaliacao, dH.data_leilao, dH.modalidade, dH.encerrado, dH.fotos.length], [70000, 80000, '2026-12-31', 'venda_direta', false, 5]);
  const rowH = PORTAL.montarRow(uH, dH, T); rowH.titulo = tituloVeiculo(fx('portal-lote-harley.html'));
  const vH = veiculoDoLote(rowH, { id: PORTAL.idDaUrl(uH), fonte: T.fonte }).row;
  assert.deepEqual([vH.tipo_veiculo, vH.marca, vH.valor_minimo, vH.fonte_id], ['moto', 'HARLEY-DAVIDSON', 70000, 'portaldosleiloes_veic_harley-davidson-flhp-road-king-police']);
  // Venda direta fecha pelo STATUS do painel (a data é o prazo de proposta, não praça): o mesmo lote "Vendido" não entra.
  const vendida = fx('portal-lote-harley.html').replaceAll('Aberto para Lances', 'Vendido');
  assert.equal(PORTAL.parseDetalhe(vendida, uH, { agora: AGORA }).encerrado, true);
}

// ══ CLÁSSICO (Simões, VJ, Marco Aurélio) ═════════════════════════════════════════════════════════
{
  const M = CL.TENANTS.marco;
  const en = await silencioso(() => enumerar(fetchDe({ [`${M.base}/categoria/Im%C3%B3veis`]: 'classico-marco-imoveis.html' }), M, cfgClassico, { maxPages: 5, semBD: true }));
  assert.equal(CL.totalDaCategoria(fx('classico-marco-imoveis.html'), 'Im'), 2);
  assert.deepEqual([en.urls.length, en.completa, en.detCatalogo.size], [2, true, 2], '2 de 2 que o menu declara; o card é o detalhe');
  const det = en.detCatalogo.get(`${M.base}/lote/266/terreno-urbano-com-350-00m2-no-loteamento-mineracao-geral-do-brasil-icara-sc`);
  assert.deepEqual([det.cidade, det.estado, det.valor_minimo, det.area_m2, det.tipo], ['Içara', 'SC', 200000, 350, 'terreno']);
  assert.equal(det.encerrado, true, 'praças de 21 e 28/06/2023');
  // Com praça futura, o mesmo card fica aberto e a 1ª/2ª praças entram.
  const c = CL.cards(fx('classico-marco-imoveis.html'))[0];
  const aberto = CL.detalheDoCard(c, 'u', { agora: new Date('2023-06-01T12:00:00-03:00') });
  assert.deepEqual([aberto.encerrado, aberto.data_leilao, aberto.data_leilao_2], [false, '2023-06-21', new Date('2023-06-28T16:00:00-03:00').toISOString()]);
  // Simões: Imóveis sem card (vazio); os 8 "Veículos" são RASCUNHO de demonstração — encerrados, foto da intranet fora.
  const S = CL.TENANTS.simoes;
  assert.equal(CL.extrairUrlsDeLote(fx('classico-simoes-imoveis.html'), S.base).size, 0);
  const rasc = [...CL.detalhesDoCatalogo(fx('classico-simoes-veiculos.html'), S.base).values()];
  assert.equal(rasc.length, 8);
  assert.ok(rasc.every((x) => x.encerrado && x.status === 'Rascunho' && !x.link_foto));
  assert.equal(CL.extrairUrlsDeLote(fx('classico-vj-imoveis.html'), CL.TENANTS.vj.base).size, 0);
}

// ══ uma fonte por site (o sweep do motor é por `fonte`) ══════════════════════════════════════════
{
  const fontes = [cfgLancevip, cfgVix, cfgPortal, cfgClassico].flatMap((c) => c.tenants.map((t) => t.fonte));
  assert.equal(new Set(fontes).size, fontes.length, 'nenhuma fonte compartilhada entre sites');
  assert.deepEqual(fontes, ['LANCEVIP', 'VIXLEILOES', 'PORTALDOSLEILOES', 'SIMOESLEILOES', 'VJLEILOES', 'MARCOLEILOES']);
}

console.log('✅ suporte-next: LanceVIP 26/26, VIX (eventos abertos, corte protegido), Portal (zero declarado; veículos abertos 49/49 cards, corte não grava), clássico 2/2 — ok');
