// Front "lei-" multi-site da Suporte (17/11): Saraiva/Ananda migraram do template antigo para o do Portal dos Leilões.
// Fixtures REAIS de saraivaleiloes.com.br lidas pelo banco (pg_net) em 17/11.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PORTAL } from '../lib/suporte-next-parse.mjs';
import { enumerar } from '../lib/motor/runner.mjs';
import cfg, { TENANTS } from '../lib/motor/fontes/suportelei.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/suporte-next/${n}`, import.meta.url), 'utf8');
const base = TENANTS.saraiva.base;

// Detalhe: leiloeira lida na página, fotos só do próprio bem (a página tem "Veja também" com fotos de outros lotes).
const det = PORTAL.parseDetalhe(fx('saraiva-lote-frigorifico.html'), `${base}/lote/frigorifico-em-itajuba-mg`);
assert.equal(det.leiloeiro, 'Angela Saraiva Portes Souza');
assert.equal(det.cidade, 'Itajubá'); assert.equal(det.estado, 'MG');
assert.ok(det.fotos.length >= 1 && det.fotos.every((f) => f.includes('/bens/8714/')), 'foto de outro lote entrou');
assert.equal(det.encerrado, true, 'praça de 2022 tem que sair como encerrada');
assert.equal(cfg.parse.montarRow(`${base}/lote/frigorifico-em-itajuba-mg`, det, TENANTS.saraiva).leiloeiro, 'Angela Saraiva Portes Souza');

// Categoria "—" (em branco) e "Lote" (terreno) não podem descartar imóvel (dry-run ao vivo de 17/11: 5 perdidos).
const comCat = (c) => fx('saraiva-lote-frigorifico.html').replace(/(<div class="lei-lote-spec__k">Tipo<\/div>\s*<div class="lei-lote-spec__v">)[\s\S]*?(<\/div>)/, `$1${c}$2`);
for (const c of ['—', 'Lote']) assert.notEqual(PORTAL.parseDetalhe(comCat(c), `${base}/lote/x`).eh_imovel, false, `categoria "${c}" descartou imóvel`);

// Enumeração REAL do motor: agenda de leilões abertos → leilão 586 → só card ABERTO e de IMÓVEL.
const mapa = new Map([
  [`${base}/leiloes?situacao=andamento`, fx('saraiva-leiloes-andamento.html')],
  [`${base}/leilao/586-imoveis-veiculos`, fx('saraiva-leilao-586.html')],
]);
const fetchFalso = async (url) => (mapa.has(url) ? { html: mapa.get(url), via: 'fixture' } : { html: null, via: 'fixture-404' });
const r = await enumerar(fetchFalso, TENANTS.saraiva, cfg, { maxPages: 1, semBD: true });
const candidatas = [...r.urls.values()].filter(cfg.parse.urlCandidata);
assert.equal(candidatas.length, 9, `imóveis abertos do leilão 586: ${candidatas.length}`);
// Pela categoria do CARD: "Veículos"/"Materiais" ficam fora. (O card "10 portas para veículo" vem como "Imóveis" do
// próprio site — erro de cadastro da leiloeira; quem barra é o detalhe/fora-do-acervo, não este filtro.)
const catDe = new Map(PORTAL.cartoes(fx('saraiva-leilao-586.html'), base).map((c) => [c.url, c.categoria]));
assert.ok(candidatas.every((u) => catDe.get(u) === 'Imóveis'), 'card de outra categoria passou pelo filtro de imóvel');
assert.ok(!candidatas.some((u) => /fazenda-aprox-33-ha/.test(u)), 'card "Retirado" passou como aberto');
assert.ok(r.cortada, 'leilões que não abriram na fixture têm que marcar a lista como cortada (não varre sumidos)');

console.log(`✅ suporte-lei: detalhe (leiloeira, fotos do bem, encerrado), ${candidatas.length} imóveis abertos de ${[...r.urls.values()].length} cards, corte protegido — ok`);

// ── Sued Peter (front "lote__/gcard", 17/11) ─────────────────────────────────────────────────────────────────────────
import cfgSp from '../lib/motor/fontes/suedpeter.mjs';
import { FICHA } from '../lib/suporte-next-parse.mjs';
{
  const b = cfgSp.tenants[0].base;
  const det = FICHA.parseDetalhe(fx('suedpeter-lote-3458.html'), `${b}/lote/3458-casa-com-75-60m-em-nova-almeida-serra-es`, { agora: new Date('2026-11-17T12:00:00Z') });
  assert.equal(det.valor_minimo, 150000, 'praça não lida: o lance mínimo vem das props RSC, não da avaliação');
  assert.equal(det.valor_avaliacao, 300000);
  assert.equal(det.data_leilao, '2026-11-23');
  assert.equal(det.cidade, 'Serra'); assert.equal(det.estado, 'ES');
  assert.equal(det.modalidade, 'judicial'); assert.equal(det.numero_processo, '0004300-59.2007.5.17.0002');
  assert.ok(det.link_edital && det.link_matricula, 'edital e matrícula do ul.docs');
  assert.ok(det.fotos.length && det.fotos.every((f) => f.includes('/bens/2386/')));
  assert.equal(FICHA.parseDetalhe(fx('suedpeter-lote-3458.html'), `${b}/lote/3458-x`, { agora: new Date('2026-12-01T12:00:00Z') }).encerrado, true, 'praça vencida tem que encerrar');
  const mapaSp = new Map([[`${b}/lotes?categoria=Im%C3%B3veis`, fx('suedpeter-lotes-imoveis.html')]]);
  const rs = await enumerar(async (u) => (mapaSp.has(u) ? { html: mapaSp.get(u), via: 'fixture' } : { html: null, via: 'fixture-404' }), cfgSp.tenants[0], cfgSp, { maxPages: 6, semBD: true });
  const cand = [...rs.urls.values()].filter(cfgSp.parse.urlCandidata);
  assert.equal(cand.length, 16, `cards da página 1: ${cand.length}`);
  assert.ok(rs.cortada, 'página 2 linkada e não aberta = lista cortada');
  console.log(`✅ suedpeter: praça das props RSC, docs, fotos do bem, ${cand.length} cards, corte protegido — ok`);
}
