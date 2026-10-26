// PLATAFORMA MSIS (26/10) — 21 leiloeiros do RJ. Fixtures REAIS lidas pelo banco (pg_net) em 26/10:
//   • msis-bsp-catalogo-pag1.html  — Principal.asp do BSP: 12 cards, seletor até pagina(2).
//   • msis-bsp-leilao-8432.html    — Leilão 8432 (prédio em Copacabana, 2 praças, 1 lote declarado "Total: 1 lote").
//   • msis-mklance-leilao-674.html — Leilão 674 do MK Lance (execução fiscal PGFN, 3 praças, "AVALIADO em R$ 135.000,00").
//   • msis-davimattos-catalogo-externo.html — Davi Mattos: os 12 cards abrem OUTRA plataforma (eblonline) → 0 leilão MSIS.
// E o transporte (motor/fetch-msis.mjs) com fetch simulado: catálogo inteiro por POST acaoDest=N (todas as páginas
// concatenadas), host com Cloudflare cai na via banco (pagina_postar_form) e página que não abre derruba a lista.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TENANTS, cardsDoCatalogo, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, detalhesDoCatalogo, ultimaPagina, totalDeclarado, montarRow,
} from '../lib/msis-parse.mjs';
import { criarMotorMsis, COBERTURA } from '../lib/motor/fetch-msis.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const catBsp = fx('msis-bsp-catalogo-pag1.html');
const leilaoBsp = fx('msis-bsp-leilao-8432.html');
const leilaoMk = fx('msis-mklance-leilao-674.html');
const catDavi = fx('msis-davimattos-catalogo-externo.html');

// Tenants: 21, fonte única, base no domínio da triagem.
assert.equal(Object.keys(TENANTS).length, 21);
assert.equal(new Set(Object.values(TENANTS).map((t) => t.fonte)).size, 21, 'fonte duplicada');
assert.ok(Object.values(TENANTS).every((t) => /^https:\/\/www\.[a-z.]+$/.test(t.base) && t.catalogo === '/Principal.asp'));

// Catálogo: 12 cards abertos, seletor até a página 2.
const B = TENANTS.bsp.base;
const cards = cardsDoCatalogo(catBsp);
assert.equal(cards.length, 12);
assert.equal(ultimaPagina(catBsp), 2);
assert.ok(cards.every((c) => c.status === 'ABERTO PARA LANCES'));
const ev = extrairUrlsDeEvento(catBsp, B);
assert.equal(ev.size, 12);
assert.match(ev.get('20041836201068003040002'), /^https:\/\/www\.bspleiloes\.com\.br\/Leilao\.asp\?zz=20041836201068003040002&card=ABERTO%20PARA%20LANCES/, 'status do card viaja até a página do leilão');
// Card ENCERRADO não vira leilão a ler.
const comEncerrado = catBsp.replace(/value="ABERTO PARA LANCES"/, 'value="ENCERRADO"');
assert.equal(extrairUrlsDeEvento(comEncerrado, B).size, 11);
// Davi Mattos: os cards abrem outra plataforma (window.open eblonline) — nenhum é leilão MSIS.
assert.equal(cardsDoCatalogo(catDavi).length, 0);
assert.equal(extrairUrlsDeEvento(catDavi, TENANTS.davimattos.base).size, 0);

// Leilão BSP 8432: 1 lote declarado, 1 lido, praças futuras.
assert.deepEqual(totalDeclarado(leilaoBsp), { lotes: 1, paginas: 1 });
const lotesBsp = extrairUrlsDeLote(leilaoBsp, B);
assert.deepEqual([...lotesBsp.keys()], ['12965']);
const uBsp = lotesBsp.get('12965');
assert.equal(idDaUrl(uBsp), '12965');
const dBsp = detalhesDoCatalogo(leilaoBsp, B).get(uBsp);
assert.ok(dBsp, 'det do lote saiu da página do leilão');
assert.equal(dBsp.cidade, 'Rio de Janeiro');
assert.equal(dBsp.estado, 'RJ');
assert.equal(dBsp.valor_avaliacao, 7000000);
assert.equal(dBsp.valor_minimo, 3500000);
assert.equal(dBsp.encerrado, false);
assert.match(dBsp.link_foto, /\/Arquivos\/008432\/008432_012965_02_26490\.jpg$/);
assert.match(dBsp.link_edital, /\/Arquivos\/008432\/008432_000000_01_026486\.pdf$/);
assert.match(dBsp.link_matricula, /026505\.pdf$/, 'RGI é a matrícula');
const rowBsp = montarRow(uBsp, dBsp, TENANTS.bsp);
assert.equal(rowBsp.fonte_id, 'bspleiloes_12965');
assert.equal(rowBsp.url_lote, uBsp);

// MK Lance 674: execução fiscal (judicial, processo), AVALIADO 135 mil, praça vigente com lance de 67.500.
const M = TENANTS.mklance.base;
const dMk = [...detalhesDoCatalogo(leilaoMk, M).values()][0];
assert.equal(dMk.modalidade, 'judicial');
assert.equal(dMk.numero_processo, '5003432-98.2022.4.02.5101');
assert.equal(dMk.valor_avaliacao, 135000);
assert.equal(dMk.valor_minimo, 67500);
assert.equal(dMk.cidade, 'Rio de Janeiro');
assert.equal(dMk.estado, 'RJ');
assert.equal(dMk.numero_matricula, '139711');
assert.equal(dMk.area_m2, 70);
// O auditório deste lote é o COMPREI (PGFN): já entra pela fonte COMPREI — fica fora para não duplicar.
assert.equal(dMk.naoImovel, true);
assert.equal(dBsp.naoImovel, undefined);
// Com "hoje" antes da 1ª praça, a data vigente é a da 1ª.
const blocoMk = leilaoMk.slice(leilaoMk.indexOf('id="divLote2458"'));
const { parseLote } = await import('../lib/msis-parse.mjs');
assert.equal(parseLote(blocoMk, leilaoMk, M, { hoje: '2026-01-01' }).data_leilao, '2026-02-16');
// Status encerrado no lote.
assert.equal(parseLote(blocoMk.replace('ABERTO PARA LANCES', 'ARREMATADO'), leilaoMk, M).encerrado, true);

// Variantes medidas no dry-run de 26/10 (fixtures reais pelo banco):
//  • Gabriel: card "VENDA DIRETA" (só no card), praças de 2025 e "RS 210.000,00" (typo do site) → venda direta, sem data.
//  • Vianna: lote da Comprei/PGFN, card "DESCONSIDERAR AS DATAS NESTE SITE", "Avaliação | Valor Mínimo" no texto.
//  • Sérgio Represas: descrição em "CorBranca" e cidade "…, BARRA MANSA, RJ." (vírgula, conferida no IBGE).
const comCard = (h, c) => `<!-- msis-card: ${c} -->\n${h}`;
const G = TENANTS.gabriel.base;
const gab = comCard(fx('msis-gabriel-leilao-venda-direta.html'), 'VENDA DIRETA | Sala comercial na Barra');
const dGab = [...detalhesDoCatalogo(gab, G).values()][0];
assert.equal(dGab.modalidade, 'venda_direta');
assert.equal(dGab.data_leilao, null);
assert.equal(dGab.valor_minimo, 210000, '"RS 210.000,00" lido');
assert.match(dGab.titulo, /^Av\. das Américas/, 'abreviação "Av." não corta o título');
const V = TENANTS.vianna.base;
const vian = comCard(fx('msis-vianna-leilao-comprei.html'), 'ABERTO PARA LANCES | Condições de PARCELAMENTO em até 60x. DESCONSIDERAR AS DATAS NESTE SITE.');
assert.deepEqual(totalDeclarado(vian), { lotes: 10, paginas: 1 });
const dets = [...detalhesDoCatalogo(vian, V).values()];
assert.equal(dets.length, 10, 'completude: 10 de 10');
assert.ok(dets.every((d) => d.modalidade === 'venda_direta' && d.data_leilao === null));
const cinema = dets.find((d) => /^CINEMA/.test(d.titulo));
assert.equal(cinema.valor_avaliacao, 30400000);
assert.equal(cinema.valor_minimo, 15200000);
assert.equal(cinema.cidade, 'São Paulo');
assert.equal(cinema.naoImovel, true, 'lote da Comprei não duplica a fonte COMPREI');
const S = TENANTS.sergiorepresas.base;
const dSer = [...detalhesDoCatalogo(fx('msis-sergiorepresas-leilao-barramansa.html'), S).values()];
assert.equal(dSer.length, 2);
assert.ok(dSer.every((d) => d.cidade === 'Barra Mansa' && d.estado === 'RJ' && d.descricao));

// ── TRANSPORTE: catálogo inteiro por POST, via banco no Cloudflare ─────────────────────────────────────────
process.env.VITE_SUPABASE_URL = 'https://banco.exemplo';
process.env.SUPABASE_SERVICE_KEY = 'chave-teste';
const pag2 = catBsp.replace(/abrirDetalhesLeilao\('(\d+)'\)/g, (m, zz) => `abrirDetalhesLeilao('9${zz.slice(1)}')`).replace(/pagina\(2\)/g, 'pagina(1)');
const pedidos = [];
const resp = (corpo, status = 200) => new Response(corpo, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
let bancoPedidos = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  pedidos.push({ u, metodo: opts.method || 'GET', corpo: opts.body || '' });
  if (u.startsWith('https://banco.exemplo/rest/v1/rpc/')) {
    const fn = u.split('/').pop();
    const body = JSON.parse(opts.body);
    if (fn === 'pagina_postar_form') { bancoPedidos++; return new Response(JSON.stringify(1000 + Number(body.p_campos.pag)), { status: 200 }); }
    if (fn === 'pagina_ler') return new Response(JSON.stringify([{ pronto: true, status: 200, conteudo: body.p_id === 1001 ? catBsp : pag2, erro: null }]), { status: 200 });
    return new Response('[]', { status: 404 });
  }
  if (u.includes('cloudflare.exemplo')) return resp('<title>Just a moment...</title>', 403);
  const pag = new URLSearchParams(opts.body || '').get('pag');
  assert.equal(new URLSearchParams(opts.body || '').get('acaoDest'), 'N', 'catálogo pede acaoDest=N');
  return resp(pag === '2' ? pag2 : catBsp);
};
const { fetchFonte } = criarMotorMsis();
const r1 = await fetchFonte('https://www.direto.exemplo/Principal.asp');
assert.equal(extrairUrlsDeEvento(r1.html, 'https://www.direto.exemplo').size, 24, 'as duas páginas do catálogo concatenadas');
assert.ok(pedidos.filter((p) => p.metodo === 'POST').length === 2, 'uma POST por página');
const r2 = await fetchFonte('https://www.direto.exemplo/Principal.asp?pag=2');
assert.equal(r2.html, r1.html, '2ª chamada do runner devolve a mesma lista (o laço para)');
const rc = await fetchFonte('https://www.cloudflare.exemplo/Principal.asp');
assert.ok(rc.html, 'Cloudflare no direto → via banco');
assert.equal(bancoPedidos, 2, 'banco recebeu as duas páginas por pagina_postar_form');
assert.equal(COBERTURA.get('www.cloudflare.exemplo').leiloes, 24);
assert.ok(COBERTURA.get('www.cloudflare.exemplo').via.has('banco'));
// Página 2 que não abre derruba a lista do tenant (nunca metade como se fosse tudo).
globalThis.fetch = async (url, opts = {}) => {
  const pag = new URLSearchParams(opts.body || '').get('pag');
  if (String(url).includes('banco.exemplo')) return new Response('erro', { status: 500 });
  return pag === '2' ? resp('', 500) : resp(catBsp);
};
const rf = await criarMotorMsis().fetchFonte('https://www.falha.exemplo/Principal.asp');
assert.equal(rf.html, null);
assert.match(rf.via, /página 2\/2 não abriu/);

console.log('ok — msis: 21 tenants, catálogo 12 cards/2 páginas, BSP 8432 e MK 674 parseados, Davi Mattos 0 (externo), POST + via banco + falha que não vira lista parcial');
