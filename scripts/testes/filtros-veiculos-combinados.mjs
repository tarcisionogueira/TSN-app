// Filtros da busca de veículos COMBINADOS (29/09, pedido do dono: "selecionar vários filtros
// simultaneamente sem dar erro"). Usa o aplicarFiltros do PRÓPRIO BuscaVeiculos.jsx (lido do
// arquivo, sem cópia) e confere que CADA filtro marcado vira condição na URL — e que os vários
// OR (cidade, marca, modelo, monta, resultado) saem como parâmetros SEPARADOS (o PostgREST faz
// AND entre eles; fundir num só OR trocaria "e" por "ou"). Validado ao vivo em 29/09: 8/8
// combinações com a mesma contagem da API pública e do SQL direto.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { ORIGENS_EXTRAJUDICIAIS } from '../../src/utils/origemVeiculo.js';

const src = fs.readFileSync(new URL('../../src/pages/BuscaVeiculos.jsx', import.meta.url), 'utf8');
const corta = (ini) => { const i = src.indexOf(ini); if (i < 0) throw new Error(`não achei ${ini}`); return src.slice(i, src.indexOf('\n}\n', i) + 2); };
const aplicarFiltros = new Function('MONTA_NAO_INFORMADA', 'ORIGENS_EXTRAJUDICIAIS', 'parseDataLocal',
  `${corta('function calcularJanelaPrazo(')}\n${corta('function aplicarFiltros(')}\nreturn aplicarFiltros;`)('nao_informado', ORIGENS_EXTRAJUDICIAIS, (d) => new Date(d));
const sb = createClient('https://exemplo.supabase.co', 'x');
const vazio = { estado: [], cidade: [], tipoVeiculo: '', marca: '', modelo: '', anoMin: '', anoMax: '', valorMax: '', valorAvaliacaoMax: '', descontoMin: '', tipoMonta: [], origem: '', prazo: '', resultadoLeilao: '', motor: '' };
const url = (f) => decodeURIComponent(aplicarFiltros(sb.from('veiculos_leilao').select('id'), { ...vazio, ...f }).url.search).replace(/\+/g, ' ');

let ok = 0, falhas = 0;
const tem = (n, u, trecho) => { const p = u.includes(trecho); p ? ok++ : falhas++; if (!p) console.log('✗', n, '— faltou', trecho, '\n  ', u); };

const tudo = url({ estado: ['SP', 'PR'], cidade: ['Guarulhos|SP', 'Curitiba|PR'], tipoVeiculo: 'carro', marca: 'honda', modelo: 'civic', anoMin: '2010', anoMax: '2024', valorMax: '80000', tipoMonta: ['média monta', 'nao_informado'], origem: 'extrajudicial', resultadoLeilao: 'vendido', motor: 'nao_funciona' });
for (const t of ['estado=in.(SP,PR)', 'and(cidade.eq."Guarulhos",estado.eq.SP)', 'and(cidade.eq."Curitiba",estado.eq.PR)', 'tipo_veiculo=eq.carro',
  'marca.ilike.%honda%', 'modelo.ilike.%civic%', 'ano_fabricacao=gte.2010', 'ano_fabricacao=lte.2024', 'valor_minimo=lte.80000',
  'sinistro.is.null', 'origem_venda=in.(', 'resultado_leilao.eq.vendido', 'motor_status=eq.nao_funciona']) tem('tudo junto', tudo, t);
const nOr = (tudo.match(/[?&]or=/g) || []).length;
nOr === 5 ? ok++ : (falhas++, console.log('✗ esperava 5 OR separados (cidade, marca, modelo, monta, resultado), veio', nOr));
tem('motor não informado', url({ motor: 'nao_informado' }), 'motor_status=is.null');
tem('cidade com apóstrofo', url({ cidade: ["Santa Bárbara D'Oeste|SP"] }), `cidade.eq."Santa Bárbara D'Oeste"`);
const nada = url({});
!/estado=|cidade|motor_status|or=/.test(nada) ? ok++ : (falhas++, console.log('✗ sem filtro marcado não pode filtrar nada:', nada));
console.log(`${falhas ? '✗' : '✓'} filtros-veiculos-combinados: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
