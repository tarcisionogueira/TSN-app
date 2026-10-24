#!/usr/bin/env node
/**
 * npm run testar:pecini-fila — fila de coleta da família sitemap DefaultClean (scraper-pecini.mjs: PECINI,
 * SUBLIME, PW), lib/pecini-fila.mjs. Pendência #358 (24/10).
 *
 * Dado REAL: o sitemap.xml do Sublime e o estado de imoveis_leilao (fonte SUBLIME) no mesmo instante, 24/10.
 * Antes: a fila era `novos.length ? novos : antigos` e havia sempre ~17 "novos" que nunca viram linha (carro,
 * moto, máquina, recusado na qualidade) — toda rodada recusava os mesmos e os 45 imóveis gravados nunca eram
 * relidos (31 com praça futura parados 4+ dias). Roda em seco, sem rede e sem banco.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { planejarFilaSitemap, naoImovelPeloEndereco, naoImovelPelaPagina } from '../lib/pecini-fila.mjs';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/sublime-sitemap-2026-10-24.json', import.meta.url), 'utf8'));
const BASE = 'https://www.sublimeleiloes.com.br';
// Mesma extração do parseSitemap (scraper-pecini.mjs): /lote/{slug}/{id}/ — "citroën-…" fica de fora lá também.
const lotes = [...new Map([...fx.sitemap.map(u => `${BASE}/lote/${u}/`).join('\n').matchAll(/\/lote\/([a-z0-9-]+)\/(\d+)\/?/gi)]
  .map(m => [m[2], { id: m[2], loteUrl: `${BASE}/lote/${m[1]}/${m[2]}/` }])).values()];
const noBanco = new Map(fx.banco.map(([id, ativo, at]) => [`sublime_${id}`, { ativo: !!ativo, atualizado_em: at }]));
const base = { lotes, noBanco, prefixo: 'sublime_', maxLotes: 40 };

// 1) Classificação pelo ENDEREÇO: as motos e as máquinas passavam (só `motos?` casava) e viraram "terreno".
assert.equal(naoImovelPeloEndereco(`${BASE}/lote/2-motocicletas-em-cruzeiro/3219/`), true);
assert.equal(naoImovelPeloEndereco(`${BASE}/lote/maquinas-industriais-em-canas-sp/3454/`), true);
assert.equal(naoImovelPeloEndereco(`${BASE}/lote/mancal-para-turbina/3249/`), true);
assert.equal(naoImovelPeloEndereco(`${BASE}/lote/peugeot-206/3377/`), true);
for (const ok of ['terreno-em-fordlandia-pa/1', 'casa-e-sitio-em-franca-e-ribeirao-corrente/3460', 'predio-comercial-na-penha/2696',
  'complexo-urbano-no-rancho-do-abilio-sp/3413', 'conjunto-comercial-no-centro-i/2756']) {
  assert.equal(naoImovelPeloEndereco(`${BASE}/lote/${ok}/`), false, ok);
}
// …e pela PÁGINA: o <title> real do 3219 em 24/10 diz a categoria que o título do parse corta.
assert.equal(naoImovelPelaPagina(`${BASE}/lote/x/1/`, 'Lote principal | Exercício de preferência',
  'Lote principal | Exercício de preferência Motos em leilão | Sublime Leilões'), true);
assert.equal(naoImovelPelaPagina(`${BASE}/lote/x/1/`, '2 dormitórios | 49m² útil', '2 dormitórios | 49m² útil Apartamentos em leilão | Sublime Leilões'), false);

// 2) Caminho GRÁTIS (runner residencial): novos primeiro, e a sobra relê os ATIVOS do mais velho para o mais novo.
const p = planejarFilaSitemap({ ...base, releituraLivre: true });
assert.equal(lotes.length, 110);
assert.equal(p.foraPeloEndereco.length, 19, 'carros, motos e máquinas saem antes de ocupar vaga');
assert.deepEqual(p.naoImovelNoAcervo.sort(), ['sublime_3219', 'sublime_3454'], 'os dois gravados como terreno saem do acervo');
assert.deepEqual(p.novos.map(l => l.id), ['3443', '3191', '3436'], 'os 3 que o banco não tem (antes: 17, quase todos carro/moto/máquina)');
assert.equal(p.antigos.length, 43, '45 ativos − 2 não-imóveis');
assert.equal(p.fila.length, 40, 'teto inteiro usado');
assert.equal(p.iReleitura, 3);
assert.ok(p.fila.slice(3).every(l => noBanco.get(`sublime_${l.id}`)?.ativo), 'releitura só de ativo (inativo não ressuscita)');
const idade = p.fila.slice(3).map(l => noBanco.get(`sublime_${l.id}`).atualizado_em);
assert.deepEqual(idade, [...idade].sort(), 'mais velho primeiro');
assert.equal(p.fila[3].id, '3427', 'o ativo mais parado (27/09) é o primeiro relido');

// 3) Recusado há pouco não volta como "novo" (memória coleta_lote_recusado).
const r = planejarFilaSitemap({ ...base, releituraLivre: true, recusados: new Set(p.novos.map(l => `sublime_${l.id}`)) });
assert.equal(r.novos.length, 0);
assert.equal(r.recusadosPulados, 3);
assert.equal(r.fila.length, 40);

// 4) Caminho PAGO (Bright Data): a regra antiga fica — releitura nunca paga enquanto houver novo.
const pago = planejarFilaSitemap({ ...base, releituraLivre: false });
assert.deepEqual(pago.fila.map(l => l.id), pago.novos.map(l => l.id));
// 5) PECINI: slug "<cidade>-<uf>", sem filtro de não-imóvel (como sempre foi).
assert.equal(planejarFilaSitemap({ ...base, filtrarNaoImovel: false }).foraPeloEndereco.length, 0);

console.log('✓ pecini-fila: classificação, fila grátis com releitura, memória de recusa, caminho pago e PECINI');
