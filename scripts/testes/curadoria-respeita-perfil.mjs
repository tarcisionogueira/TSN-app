/**
 * npm run testar:curadoria — a curadoria das oportunidades (api/_curadoria.js) escolhe pelo
 * CLIENTE, não só pelo desconto. Caso real (24/09): Alessandra, "uso próprio", 150-400k,
 * Carapicuíba, abriu apartamentos/casas em Osasco e Barueri. A regra antiga (só desconto)
 * punha uma VAGA DE GARAGEM em 3º lugar; ela abria todo e-mail e nunca clicava.
 */
import { pontuarCandidato, resumoComportamento, curarComIA } from '../../api/_curadoria.js';

let falhas = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { falhas++; console.log(`  ✗ ${m}`); } };
const lote = (titulo, tipo, v, d, lat, lng, extra = {}) => ({ titulo, tipo, valor_minimo_ref: v, desconto_percentual: d, latitude: lat, longitude: lng, link_foto: 'x', data_leilao: '2026-10-01', ...extra });
const ctx = {
  perfil_investidor: 'uso_proprio', faixa_capital: '150_400k', tetoPerfil: 520000,
  centro: { lat: -23.5235, lng: -46.8407 }, origem: 'regiao',
  comportamento: resumoComportamento([{ tipo: 'apartamento', cidade: 'Osasco', valor_minimo_ref: 241839 }, { tipo: 'casa', cidade: 'Barueri', valor_minimo_ref: 329800 }, { tipo: 'apartamento', cidade: 'Carapicuiba', valor_minimo_ref: 238047 }]),
};
const casaPerto = pontuarCandidato(lote('Casa 228m² Osasco', 'casa', 196666, 50, -23.572, -46.814), ctx);
const vaga = pontuarCandidato(lote('Vaga de Garagem na Bela Vista', 'terreno', 23730, 74, -23.533, -46.64), ctx);
const terreno = pontuarCandidato(lote('Terreno 1.900m² Santo André', 'terreno', 107421, 60, -23.674, -46.543), ctx);
const casaLonge = pontuarCandidato(lote('Casa em Santo André', 'casa', 302506, 60, -23.635, -46.497), ctx);

console.log('\nUSO PRÓPRIO: MORADIA PERTO VENCE DESCONTO MAIOR');
ok(casaPerto.pontos > vaga.pontos, 'casa a 6 km (50%) na frente de vaga de garagem (74%)');
ok(casaPerto.pontos > terreno.pontos, 'casa a 6 km na frente de terreno (60%)');
ok(casaPerto.pontos > casaLonge.pontos, 'mesma categoria: a mais perto vence a de 37 km');
ok(casaPerto.motivos.some(m => /km de você/.test(m)), 'motivo cita a distância');

console.log('\nFILTRO SALVO CONTINUA NA FRENTE');
const doFiltro = pontuarCandidato(lote('Apto no filtro', 'apartamento', 250000, 40, -23.6, -46.7), { ...ctx, origem: 'filtro' });
const semFiltro = pontuarCandidato(lote('Apto sugerido', 'apartamento', 250000, 40, -23.6, -46.7), ctx);
ok(doFiltro.pontos > semFiltro.pontos, 'mesmo lote pontua mais quando veio do filtro salvo');

console.log('\nIA SEM CHAVE É FALHA DECLARADA, NÃO LISTA VAZIA');
const antes = { a: process.env.CLAUDE_KEY, b: process.env.ANTHROPIC_API_KEY };
delete process.env.CLAUDE_KEY; delete process.env.ANTHROPIC_API_KEY;
const r = await curarComIA([], ctx);
ok(r.ok === false && /ausente/.test(r.erro), `curarComIA sem chave → { ok:false, erro } (${r.erro})`);
if (antes.a) process.env.CLAUDE_KEY = antes.a; if (antes.b) process.env.ANTHROPIC_API_KEY = antes.b;

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
