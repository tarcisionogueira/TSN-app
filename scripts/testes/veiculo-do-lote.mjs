// Teste puro de lib/veiculo-do-lote.mjs (21/10) — casos reais da varredura de captura.
import { veiculoDoLote, ehVeiculoInteiro } from '../lib/veiculo-do-lote.mjs';
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.error('✗', m); } else console.log('✓', m); };

const base = { valor_minimo: 45000, valor_avaliacao: 0, cidade: 'Santo André', estado: 'SP', data_leilao: '2026-10-23', url_lote: 'https://x/lote/1', link_foto: 'https://x/f.jpg' };
const corolla = veiculoDoLote({ ...base, titulo: 'TOYOTA/COROLLA GLI UPPER - 2018/2019', descricao: 'TOYOTA/COROLLA GLI UPPER, 18/19, PLACA: QXX1A27, GASOL/ALC, PRATA IPVA 2026 PAGO AR COND. DIR. HIDR. Comitente: FINANCEIRA' }, { id: '8132-1', fonte: 'FREITAS' });
ok(corolla.row && !corolla.motivo, 'Freitas Corolla vira veículo');
ok(corolla.row?.marca === 'TOYOTA' && corolla.row?.ano_modelo === 2019, 'marca e ano do título');
ok(corolla.row?.status_patio === 'confirmado', 'comitente financeira = pátio confirmado');
ok(corolla.row?.fonte_id === 'freitas_veic_8132-1', 'fonte_id com _veic_');
ok(corolla.row?.data_leilao === '2026-10-23T12:00:00-03:00', 'data texto → timestamptz');
ok(corolla.row?.placa === 'QXX1A27', 'placa');

const executado = veiculoDoLote({ ...base, titulo: 'VW/GOL 1.0 2012/2013', descricao: 'Veículo VW/GOL 1.0, ano 2012/2013. O bem encontra-se COM O EXECUTADO no endereço Rua X, 10, Centro.' }, { id: '2', fonte: 'X' });
ok(executado.motivo && /executado/.test(executado.motivo), 'bem com o executado nunca é gravado');

const semFicha = veiculoDoLote({ ...base, titulo: 'HONDA/CG 160 FAN 2022/2023', descricao: 'HONDA/CG 160 FAN 2022/2023' }, { id: '3', fonte: 'X' });
ok(semFicha.row?.status_patio === 'indefinido' && /não lida/.test(semFicha.row?.status_patio_motivo), 'sem ficha: indefinido dizendo que não leu');
ok(semFicha.row?.tipo_veiculo === 'moto', 'CG 160 é moto');

ok(!ehVeiculoInteiro('SUCATA VEICULAR FIAT UNO'), 'sucata fica fora');
ok(!ehVeiculoInteiro('Trator Massey Ferguson 275'), 'trator fica fora');
ok(!ehVeiculoInteiro('Apartamento em Santos/SP com vaga de garagem'), 'imóvel fica fora');
ok(ehVeiculoInteiro('Caminhão Mercedes-Benz 710'), 'caminhão entra');
ok(veiculoDoLote({ ...base, valor_minimo: 0, titulo: 'FIAT/UNO 2010/2011', descricao: '' }, { id: '4', fonte: 'X' }).motivo === 'sem valor', 'sem valor não grava');

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nveiculo-do-lote: todos os casos passaram');
