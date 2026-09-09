/**
 * npm run testar:niveis — a régua de amostras do mercadológico tem TRÊS níveis, e a soma é uma só.
 *
 * Regra do dono (09/09): nível 1 no mesmo condomínio/endereço até 250 m, nível 2 até 1 km, e,
 * quando faltar amostra, um nível 3 até 2 km "para encontrar amostras e apresentar dados".
 *
 * O nível 3 já acontecia — o prompt mandava expandir até 2 km — mas voltava DENTRO do nivel2,
 * que a tela rotula "250 m a 1 km": dado certo publicado com o nome de outra faixa. Agora é um
 * balde próprio, e este teste vigia as duas coisas que quebram sozinhas: a soma (que estava
 * escrita à mão em ~50 lugares) e a régua no prompt.
 */
import { readFileSync } from 'node:fs';
import { NIVEIS, RAIO_NIVEL, MIN_AMOSTRAS_ANTES_DO_NIVEL3, vendasDe, locacoesDe, totalAmostrasDe, semAmostras } from '../../src/lib/niveis-mercado.js';
import { promptComparaveis } from '../../api/gerar-analise.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nA SOMA ENXERGA OS TRÊS NÍVEIS');
{
  const m = {
    nivel1: { vendas: [1, 2], locacoes: [3], totalAmostras: 3 },
    nivel2: { vendas: [4, 5], locacoes: [], totalAmostras: 2 },
    nivel3: { vendas: [6, 7, 8], locacoes: [9], totalAmostras: 4 },
  };
  checa('vendas somam os três', vendasDe(m).length === 7, vendasDe(m).length);
  checa('locações somam os três', locacoesDe(m).length === 2);
  checa('total soma os três', totalAmostrasDe(m) === 9, totalAmostrasDe(m));
  checa('o nível 3 não é ignorado no total', totalAmostrasDe(m) > totalAmostrasDe({ ...m, nivel3: undefined }));
}
checa('relatório antigo (sem nivel3) continua somando certo',
  totalAmostrasDe({ nivel1: { vendas: [1], totalAmostras: 1 }, nivel2: { vendas: [2], totalAmostras: 1 } }) === 2);
checa('nível sem totalAmostras cai na contagem do que trouxe',
  totalAmostrasDe({ nivel3: { vendas: [1, 2], locacoes: [3] } }) === 3);
checa('sem amostra nenhuma → semAmostras', semAmostras({ nivel1: { vendas: [], locacoes: [] } }));
checa('mercado nulo não quebra', semAmostras(null) === true && vendasDe(null).length === 0);
checa('lista fora do formato não quebra', vendasDe({ nivel1: { vendas: 'nao-e-array' } }).length === 0);

console.log('\nOS RAIOS SÃO OS QUE O DONO PEDIU');
checa('nível 1 = mesmo condomínio/endereço até 250 m', /250\s*m/.test(RAIO_NIVEL.nivel1) && /condom/i.test(RAIO_NIVEL.nivel1));
checa('nível 2 = 250 m a 1 km', /250\s*m/.test(RAIO_NIVEL.nivel2) && /1\s*km/.test(RAIO_NIVEL.nivel2));
checa('nível 3 = 1 km a 2 km', /1\s*km/.test(RAIO_NIVEL.nivel3) && /2\s*km/.test(RAIO_NIVEL.nivel3));
checa('a lista de níveis tem exatamente os três', NIVEIS.join(',') === 'nivel1,nivel2,nivel3');

console.log('\nO PROMPT PEDE O NÍVEL 3, E COM AS CONDIÇÕES CERTAS');
{
  const p = promptComparaveis({ endereco: 'Rua X, 100', tipoImovel: 'apartamento', areaM2: 60, cidade: 'Vila Velha', estado: 'ES', nomeCondominio: 'Ed. Teste' });
  checa('anuncia até três níveis', /AT[ÉE] TR[ÊE]S N[ÍI]VEIS/i.test(p));
  checa('tem a seção do nível 3', /N[ÍI]VEL 3/.test(p));
  checa('o nível 3 vai de 1 km a 2 km', /1km a 2km|1 km a 2 km/.test(p));
  checa('o gatilho é a falta de amostra nos níveis 1 e 2', new RegExp(`MENOS de ${MIN_AMOSTRAS_ANTES_DO_NIVEL3}`).test(p));
  checa('abaixo de 5 o nível 3 é obrigatório', /menos de 5[^.]*OBRIGAT[ÓO]RIO/i.test(p));
  checa('manda NÃO misturar no nivel1/nivel2', /NUNCA misturadas em nivel1\/nivel2/.test(p));
  checa('exige distanciaKm nas amostras do nível 3', /"distanciaKm" preenchido/.test(p));
  checa('exige peso menor na média', /PESO MENOR/.test(p));
  checa('o JSON pedido tem o balde nivel3', /"nivel3":\s*\{/.test(p));
  checa('mantém o teto duro de 2 km', /Mais de 2km: N[ÃA]O USE/.test(p));
  checa('não promete nível 3 sem condição (o teto de 1km segue valendo p/ 1 e 2)',
    /NUNCA use amostra a mais de 1km nos n[íi]veis 1 e 2/.test(p));
}

console.log('\nNINGUÉM MAIS SOMA NÍVEL À MÃO');
{
  const ler = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const [nome, arq] of [['o servidor', '../../api/gerar-analise.js'], ['a tela', '../../src/pages/Analise.jsx'], ['o PDF', '../../src/components/RelatorioPDF.jsx']]) {
    const src = ler(arq);
    checa(`${nome} importa a régua`, /niveis-mercado/.test(src));
    // O padrão proibido é o par escrito à mão: nivel1?.X ... nivel2?.X somados na mesma expressão.
    const paresNaMao = (src.match(/nivel1\?\.(vendas|locacoes|totalAmostras)[^\n]{0,120}nivel2\?\.(vendas|locacoes|totalAmostras)/g) || [])
      .filter((t) => /\+|\.\.\./.test(t));
    checa(`${nome} não soma nível 1 + nível 2 à mão`, paresNaMao.length === 0, paresNaMao.slice(0, 2));
  }
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 25) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
