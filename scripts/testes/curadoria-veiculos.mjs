/**
 * scripts/testes/curadoria-veiculos.mjs — 23/10. Tranca as regras do bloco de veículos do e-mail:
 * declarado manda, "não" zera, sucata só para quem recupera, aprendizado só com 2+ cliques e
 * fadiga que reduz (nunca zera) quem não declarou e não clica.
 */
import { perfilVeiculo, veiculoElegivel, selecionarVeiculos } from '../../api/_curadoria-veiculos.js';

let falhas = 0;
const ok = (c, o) => { if (c) console.log(`  ✓ ${o}`); else { falhas++; console.log(`  ✗ ${o}`); } };
const AGORA = Date.parse('2026-10-23T12:00:00Z');
const futuro = '2026-10-30T13:00:00Z';
let n = 0;
const V = (o) => ({ id: `v${++n}`, tipo_veiculo: 'carro', marca: 'FIAT', modelo: `M${n}`, valor_minimo: 20000, valor_fipe: 40000,
  desconto_fipe_percentual: 40, fotos: ['x'], data_leilao: futuro, estado: 'MG', cidade: 'Belo Horizonte', ano_modelo: 2019, ...o });
const env = (d) => ({ sinal: 'enviado', criado_em: `${d}T11:00:00Z` });
const cli = (d, v) => ({ sinal: 'clique', criado_em: `${d}T15:00:00Z`, veiculo: v });

ok(perfilVeiculo({ interesse_veiculos: 'nao' }).quantidade === 0, '"não" declarado = nenhum veículo');
const dm = perfilVeiculo({ interesse_veiculos: 'moto', veiculo_finalidade: 'uso' });
ok(dm.quantidade === 5 && dm.tipos.join() === 'moto' && !dm.aceitaSucata, 'declarou moto/uso = 5 motos, sem sucata');
ok(perfilVeiculo({ interesse_veiculos: 'carro', veiculo_finalidade: 'recuperar' }).aceitaSucata, 'recuperar = aceita sucata');

const novo = perfilVeiculo({}, []);
ok(novo.quantidade === 5 && novo.origem === 'teste' && !novo.aceitaSucata, 'sem declaração e sem histórico = 5 de teste, sem sucata');
ok(perfilVeiculo({}, [env('2026-10-01'), env('2026-10-08'), env('2026-10-15')]).quantidade === 2, '3 envios sem clique = 2');
ok(perfilVeiculo({}, ['01', '02', '03', '04', '05', '06'].map(d => env(`2026-09-${d}`))).quantidade === 1, '6 envios sem clique = 1 (nunca zero)');
const umClique = perfilVeiculo({}, [env('2026-10-01'), env('2026-10-08'), env('2026-10-15'), cli('2026-10-15', V({ tipo_veiculo: 'moto' }))]);
ok(umClique.quantidade === 5 && umClique.tipoPreferido === null, 'clicou uma vez = volta a 5, mas 1 clique não vira preferência');
const motoqueiro = perfilVeiculo({}, [cli('2026-10-01', V({ tipo_veiculo: 'moto', marca: 'HONDA' })), cli('2026-10-08', V({ tipo_veiculo: 'moto', marca: 'HONDA', valor_minimo: 9000 }))]);
ok(motoqueiro.tipoPreferido === 'moto' && motoqueiro.marcaPreferida === 'HONDA' && motoqueiro.precoAlvo > 0 && motoqueiro.origem === 'aprendido', '2 cliques em moto Honda = aprende tipo, marca e preço');
const sucateiro = perfilVeiculo({}, [cli('2026-10-01', V({ is_sucata: true })), cli('2026-10-02', V({ is_sucata: true }))]);
ok(sucateiro.aceitaSucata, '2 cliques em sucata = passa a aceitar sucata');

const pv = perfilVeiculo({ interesse_veiculos: 'carro', veiculo_finalidade: 'uso' });
ok(!veiculoElegivel(V({ is_sucata: true }), pv, AGORA), 'sucata barrada para quem quer rodar');
ok(!veiculoElegivel(V({ fotos: [] }), pv, AGORA), 'sem foto barrado');
ok(!veiculoElegivel(V({ data_leilao: '2026-10-20T10:00:00Z' }), pv, AGORA), 'leilão passado barrado');
ok(!veiculoElegivel(V({ tipo_veiculo: 'moto' }), pv, AGORA), 'tipo fora do declarado barrado');

const iguais = Array.from({ length: 6 }, () => V({ modelo: 'UNO' }));
const outros = [V({ modelo: 'PALIO', desconto_fipe_percentual: 10 }), V({ modelo: 'GOL', desconto_fipe_percentual: 5 })];
const sel = selecionarVeiculos([...iguais, ...outros], pv, { uf: 'MG' }, new Set([iguais[0].id]), AGORA);
ok(sel.length === 4 && sel.filter(s => s.v.modelo === 'UNO').length === 2, 'no máx. 2 do mesmo modelo; o já enviado não volta');
ok(sel[0].motivos.some(m => /FIPE/.test(m)), 'motivo cita a FIPE');
const misto = selecionarVeiculos([V({}), V({}), V({}), V({ tipo_veiculo: 'moto', desconto_fipe_percentual: 5 })], perfilVeiculo({ interesse_veiculos: 'carro_moto' }), {}, new Set(), AGORA);
ok(misto.some(s => s.v.tipo_veiculo === 'moto'), 'carro e moto declarados = ao menos uma moto mesmo com desconto menor');

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1); }
console.log('✓ curadoria-veiculos: todos os casos passaram');
