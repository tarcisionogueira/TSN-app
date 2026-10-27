// SoftGT — template da PB Castro/RMM (PR, 27/10): sem "ENDEREÇO DO BEM" nem "DESCRIÇÃO DO BEM"; a descrição está na
// seção "DETALHE DO LOTE" e a cidade só aparece no corpo. Fixture real: pbcastro.com.br/detalhe-lote/3470/1/.
import fs from 'node:fs';
import { parseDetalhe } from '../lib/softgt-parse.mjs';

const base = fs.readFileSync(new URL('./fixtures/softgt-pbcastro-lote-3470.html', import.meta.url), 'utf8');
let ok = 0, falhas = 0;
const conferir = (nome, obtido, esperado) => {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) ok++;
  else { falhas++; console.log(`✗ ${nome}: ${JSON.stringify(obtido)} ≠ ${JSON.stringify(esperado)}`); }
};

const d = parseDetalhe(base, 'https://pbcastro.com.br/detalhe-lote/3470/1/');
conferir('cidade do "CRI de Curitiba/Pr" (UF minúscula)', [d.cidade, d.estado], ['Curitiba', 'PR']);
conferir('descrição da seção DETALHE DO LOTE', /Rua Anne Frank/.test(d.descricao || ''), true);
conferir('rodapé do leiloeiro fora da descrição', /Jacarezinho/.test(d.descricao || ''), false);
conferir('valores', [d.valor_avaliacao, d.valor_minimo], [9250000, 9250000]);

// RMM (26/10): "situado na cidade de Mariluz-PR" no corpo.
const rmm = base.replace(/localizado na Rua Anne Frank[^<]*Curitiba\/Pr\./, 'situado na cidade de Mariluz-PR, com 450 m².');
const r = parseDetalhe(rmm, 'https://rmmleiloes.com.br/detalhe-lote/1/1/');
conferir('cidade "na cidade de Mariluz-PR"', [r.cidade, r.estado], ['Mariluz', 'PR']);
// Palavra/UF que não é município no IBGE não vira cidade.
const nada = base.replace(/localizado na Rua Anne Frank[^<]*Curitiba\/Pr\./, 'situado no Loteamento Bela Vista-PR.');
const n = parseDetalhe(nada, 'https://rmmleiloes.com.br/detalhe-lote/1/1/');
conferir('sem município do IBGE não chuta', n.cidade, null);

console.log(`${falhas ? '✗' : '✓'} softgt-cidade-descricao: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
