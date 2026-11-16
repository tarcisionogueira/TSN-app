// Milan — veículos (16/11). Fixture: catálogo REAL da siteback (/leiloes/15692/catalogo, 16/11) reduzido a 6 lotes:
// 029 e 052 com mínimo · 001 sem mínimo publicado · 223 empilhadeira · 061 sucata · 064 com `venda` forçada (encerrado).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { veiculoMilan, eventosEncerrados, textoLimpo, ufDoLocal, loteDisponivel } from '../lib/milan-veiculos.mjs';

const cat = JSON.parse(readFileSync(new URL('./fixtures/milan-catalogo-veiculos-15692.json', import.meta.url), 'utf8'));
const ev = { codLeilao: 15692, dataInicio: cat.dataInicio, localFotos: '15692', nProcesso: '',
  localLeilao: 'Rod. Raposo Tavares - Km 20, acesso pelo km 19,5 - antes da alça de acesso do rodoanel.',
  visitacao: 'Dias 16 e 17 de novembro, das 9h00 às 17h00, no local do leilão' };
const por = Object.fromEntries(cat.lotes.conteudo.map((l) => [l.lote, veiculoMilan(ev, l)]));

const hrv = por['052'].row;
assert.equal(por['052'].motivo, undefined);
assert.equal(hrv.fonte, 'MILAN'); assert.equal(hrv.fonte_id, 'milan_veic_15692_052');
assert.equal(hrv.marca, 'HONDA'); assert.equal(hrv.ano_fabricacao, 2022); assert.equal(hrv.ano_modelo, 2023);
assert.equal(hrv.km, 123756); assert.equal(hrv.valor_minimo, 88000);
assert.equal(hrv.estado, 'SP'); assert.equal(hrv.cidade, null);           // cidade não vem escrita: não se inventa
assert.equal(hrv.link_lote, 'https://milanleiloes.com.br/leilao/15692/lote/052');
assert.deepEqual(hrv.fotos, ['https://adm.milanleiloes.com.br/Fotos/15692/36144A.jpg']);
assert.equal(hrv.modalidade, 'extrajudicial');
assert.equal(hrv.status_patio, 'nao_confirmado');                         // pela visitação do evento, não 'indefinido'
assert.ok(!/&#\d+;|<br/i.test(hrv.descricao));                            // entidades/HTML limpos
assert.ok(hrv.descricao.endsWith('rodoanel.') && !hrv.descricao.endsWith('..'));

assert.equal(por['029'].row.tipo_veiculo, 'van_utilitario');
assert.equal(por['001'].motivo, 'sem valor');                              // mínimo não publicado: regra de todo coletor
assert.equal(por['223'].motivo, 'não é veículo inteiro');                  // empilhadeira
assert.equal(por['061'].motivo, 'não é veículo inteiro');                  // sucata
assert.equal(por['064'].motivo, 'lote encerrado/retirado');

assert.equal(textoLimpo('DIRE&#199;&#195;O <br />OK'), 'DIREÇÃO OK');
assert.equal(ufDoLocal('Av. Brasil, 100 - Campinas/SP'), 'SP');
assert.equal(ufDoLocal('local a definir'), null);

// Ciclo: evento fora da agenda E com data passada é desligado; ainda listado ou futuro, não.
const agora = Date.parse('2026-11-19T12:00:00Z');
const ativos = [
  { fonte_id: 'milan_veic_15692_052', data_leilao: '2026-11-18T12:30:00Z' }, // saiu da agenda, passou → desliga
  { fonte_id: 'milan_veic_15698_001', data_leilao: '2026-11-19T12:30:00Z' }, // saiu da agenda, ainda não passou → fica
  { fonte_id: 'milan_veic_15700_003', data_leilao: '2026-11-10T12:30:00Z' }, // passou mas ainda listado → fica
];
assert.deepEqual([...eventosEncerrados(ativos, new Set(['15700']), agora)], ['15692']);
// Lote com `fechamento` passado não é disponível, mesmo com estadoLote 101 e venda nula (15666, 16/11).
{ const l = { ...cat.lotes.conteudo[0], fechamento: '2026-11-18T13:00:00.000+00:00' };
  assert.equal(loteDisponivel(l, Date.parse('2026-11-18T12:00:00Z')), true);
  assert.equal(loteDisponivel(l, Date.parse('2026-11-18T14:00:00Z')), false); }
console.log('milan-veiculos: ok');
