/**
 * scripts/testes/curadoria-veiculos.mjs — 23/10. Tranca as regras do dono para os veículos do e-mail:
 * só quem declarou interesse (ou clicou 2+), por tipo e faixa de FIPE, de QUALQUER estado, só pátio
 * confirmado, nunca sucata.
 */
import { perfilVeiculo, veiculoElegivel, selecionarVeiculos, consultaPoolVeiculos } from '../../api/_curadoria-veiculos.js';

let falhas = 0;
const ok = (c, o) => { if (c) console.log(`  ✓ ${o}`); else { falhas++; console.log(`  ✗ ${o}`); } };
const AGORA = Date.parse('2026-10-23T12:00:00Z');
let n = 0;
const V = (o) => ({ id: `v${++n}`, tipo_veiculo: 'carro', marca: 'FIAT', modelo: `M${n}`, valor_minimo: 30000, valor_fipe: 45000,
  desconto_fipe_percentual: 33, fotos: ['x'], data_leilao: '2026-10-30T13:00:00Z', estado: 'SP', status_patio: 'confirmado', ano_modelo: 2019, ...o });
const cli = (v) => ({ sinal: 'clique', criado_em: '2026-10-20T15:00:00Z', veiculo: v });
const sim = (o = {}) => ({ interesse_veiculos: 'sim', veiculo_tipos: ['carro'], veiculo_faixa_fipe: 'ate_50k', ...o });

ok(perfilVeiculo({ interesse_veiculos: 'nao' }).quantidade === 0, '"não" = nenhum veículo');
ok(perfilVeiculo({}).quantidade === 0, 'não respondeu e não clicou = nenhum veículo');
ok(perfilVeiculo({}, [cli(V({}))]).quantidade === 0, '1 clique só não basta');
const apr = perfilVeiculo({}, [cli(V({ tipo_veiculo: 'moto', valor_fipe: 12000, marca: 'HONDA' })), cli(V({ tipo_veiculo: 'moto', valor_fipe: 15000, marca: 'HONDA' }))]);
ok(apr.quantidade === 5 && apr.origem === 'aprendido' && apr.tipos.join() === 'moto' && apr.faixa === 'ate_50k' && apr.marcaPreferida === 'HONDA', '2 cliques em moto Honda = aprende tipo, faixa e marca');
const dec = perfilVeiculo(sim({ veiculo_tipos: ['carro', 'caminhao'], veiculo_faixa_fipe: 'ate_150k' }));
ok(dec.quantidade === 5 && dec.tipos.join() === 'carro,caminhao' && dec.faixa === 'ate_150k', 'declarado = 5, tipos e faixa do questionário');
ok(perfilVeiculo(sim({ veiculo_tipos: [] })).tipos.join() === 'carro,moto', 'declarou sim sem tipo = carro e moto');

const pv = perfilVeiculo(sim());
ok(veiculoElegivel(V({ estado: 'AM' }), pv, AGORA), 'outro estado é elegível (pátio: paga só o frete)');
ok(!veiculoElegivel(V({ is_sucata: true }), pv, AGORA), 'sucata barrada');
ok(!veiculoElegivel(V({ status_patio: 'indefinido' }), pv, AGORA), 'pátio não confirmado barrado');
ok(!veiculoElegivel(V({ valor_fipe: 90000 }), pv, AGORA), 'FIPE acima da faixa barrada');
ok(!veiculoElegivel(V({ tipo_veiculo: 'moto' }), pv, AGORA), 'tipo fora do declarado barrado');
ok(!veiculoElegivel(V({ fotos: [] }), pv, AGORA) && !veiculoElegivel(V({ data_leilao: '2026-10-20T10:00:00Z' }), pv, AGORA), 'sem foto ou leilão passado barrados');
const alto = perfilVeiculo(sim({ veiculo_faixa_fipe: 'acima_150k' }));
ok(!veiculoElegivel(V({ valor_fipe: 60000 }), alto, AGORA) && veiculoElegivel(V({ valor_fipe: 220000, valor_minimo: 150000 }), alto, AGORA), 'acima de 150 mil não recebe carro de 60 mil');

const naFaixa = V({ valor_fipe: 48000, desconto_fipe_percentual: 20 });
const barato = V({ valor_fipe: 12000, desconto_fipe_percentual: 25 });
const s1 = selecionarVeiculos([barato, naFaixa], pv, new Set(), AGORA);
ok(s1[0].v.id === naFaixa.id, 'dentro da faixa ideal vence um pouco mais de desconto fora dela');
ok(s1[0].motivos.some(m => /FIPE/.test(m)), 'motivo cita a FIPE');
const iguais = Array.from({ length: 6 }, () => V({ modelo: 'UNO' }));
const sel = selecionarVeiculos(iguais, pv, new Set([iguais[0].id]), AGORA);
ok(sel.length === 2, 'no máx. 2 do mesmo modelo; o já enviado não volta');
const q = consultaPoolVeiculos(pv, '2026-10-23T00:00:00Z');
ok(!/estado=/.test(q.qs) && /status_patio=eq.confirmado/.test(q.qs) && /is_sucata/.test(q.qs) && /valor_minimo=lte.55000/.test(q.qs), 'consulta nacional, pátio confirmado, sem sucata, teto da faixa');

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1); }
console.log('✓ curadoria-veiculos: todos os casos passaram');
