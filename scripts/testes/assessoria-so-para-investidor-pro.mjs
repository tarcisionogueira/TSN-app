/**
 * npm run testar:assessoria — a assessoria só é contratável por Investidor Pro, e a regra é UMA.
 *
 * Regra do dono (09/09): "a assessoria só deve poder ser contratada por quem é Investidor Pro.
 * Para quem é explorador pode aparecer na tela de planos, mas com informações limitadas de
 * valores, informando que deve ser Investidor Pro para contratar."
 *
 * A regra JÁ era aplicada no servidor e no Checkout — escrita duas vezes, com listas literais
 * diferentes. Foi assim que 'top2_anual' ficou de fora da lista do Checkout: quem assinava o
 * Investidor Pro ANUAL era mandado de volta para "assine o Pro". Este teste vigia as duas
 * coisas: o que a regra decide, e que continue existindo uma só.
 */
import { readFileSync } from 'node:fs';
import { acessoAssessoria, podePeloPapel } from '../../src/lib/assessoria-acesso.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nQUEM NÃO PODE CONTRATAR');
for (const r of ['explorador', '', null, undefined, 'consultor', 'parceiro', 'visitante'])
  checa(`${JSON.stringify(r)} → requer_pro`, acessoAssessoria(r) === 'requer_pro', acessoAssessoria(r));

console.log('\nQUEM PODE');
for (const r of ['top2', 'assessorado'])
  checa(`${r} → pode`, acessoAssessoria(r) === 'pode', acessoAssessoria(r));
checa('top2_anual também pode (era o buraco da lista literal do Checkout)', acessoAssessoria('top2_anual') === 'pode');
checa('assessorado_anual também pode', acessoAssessoria('assessorado_anual') === 'pode');
for (const r of ['admin', 'analista', 'advogado', 'suporte'])
  checa(`equipe ${r} → pode`, acessoAssessoria(r) === 'pode');

console.log('\nLEILÃO CLUB NÃO CONTRATA AVULSA — JÁ TEM INCLUÍDA');
for (const r of ['clube', 'clube_anual'])
  checa(`${r} → incluido (nem "pode" nem "requer_pro")`, acessoAssessoria(r) === 'incluido', acessoAssessoria(r));
checa('e "incluido" não é confundido com poder contratar', podePeloPapel('clube') === false);

console.log('\nUMA REGRA SÓ — servidor, Checkout e Planos leem do mesmo arquivo');
{
  const ler = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const servidor = ler('../../api/_assessoria.js');
  const checkout = ler('../../src/pages/Checkout.jsx');
  const planos = ler('../../src/pages/Planos.jsx');
  checa('o servidor importa a regra', /assessoria-acesso/.test(servidor));
  checa('o Checkout importa a regra', /assessoria-acesso/.test(checkout));
  checa('a tela de Planos importa a regra', /assessoria-acesso/.test(planos));
  checa('o servidor não reimplementa o teste de papel',
    !/\!\/\^\(top2\|assessorado\)\//.test(servidor));
  checa('o Checkout não mantém mais a lista literal de papéis',
    !/ROLES_PRO_OU_ACIMA/.test(checkout));
  checa('a tela de Planos não decide assessoria por regex de role solta',
    !/\/\^\(top2\|assessorado\)\//.test(planos));
}

console.log('\nA TELA DE PLANOS DIZ A EXIGÊNCIA, EM VEZ DE PROMETER E BARRAR DEPOIS');
{
  const planos = readFileSync(new URL('../../src/pages/Planos.jsx', import.meta.url), 'utf8');
  checa('existe o rótulo de exclusividade', planos.includes('Exclusivo para Investidor Pro'));
  checa('a CTA de quem não é Pro não promete contratar', planos.includes('Seja Investidor Pro para contratar'));
  checa('o preço cheio só é renderizado fora do caso requer_pro',
    /requer_pro' \?[\s\S]{0,1400}<PrecoComercial planoKey="assessorado"/.test(planos));
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 27) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
