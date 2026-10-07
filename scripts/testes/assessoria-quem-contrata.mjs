/**
 * npm run testar:assessoria — QUEM pode contratar a assessoria, e que a regra continua sendo UMA.
 *
 * A regra MUDOU em 06/10 (decisão do dono, `regra_negocio['assessoria.inclui_pro']`): a assessoria
 * deixou de exigir o Investidor Pro e de cobrar a mensalidade dele — enquanto ela está ativa, o
 * papel `assessorado` já dá tudo do Pro. Explorador contrata direto; só quem não tem conta precisa
 * criar uma. Antes disso a regra era a de 09/09 ("só Investidor Pro contrata"), e este arquivo
 * ainda se chamava `assessoria-so-para-investidor-pro.mjs`.
 *
 * ⚠️ POR QUE O NOME DO ARQUIVO MUDOU JUNTO: a regra virou em 06/10 e o teste não; ele reprovou em
 * TODOS os commits de 06 e 07/10, nas duas branches, por ~24 h, cobrando um comportamento que o
 * dono tinha acabado de remover. Teste que cobra a regra velha não é rede de segurança: é ruído
 * que ensina a ignorar o CI vermelho — e foi exatamente o que aconteceu, com cinco sessões
 * empurrando commit por cima. Ao mudar uma regra de negócio, o teste dela muda no MESMO commit.
 *
 * O que ele continua vigiando, e é o motivo de existir: a regra escrita DUAS vezes diverge. Foi
 * assim que 'top2_anual' ficou de fora da lista literal do Checkout e quem assinava o Pro ANUAL
 * era mandado de volta para "assine o Pro".
 */
import { readFileSync } from 'node:fs';
import { acessoAssessoria, podePeloPapel } from '../../src/lib/assessoria-acesso.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nQUEM PRECISA CRIAR CONTA (e só isso barra hoje)');
for (const r of ['', null, undefined, 'visitante'])
  checa(`${JSON.stringify(r)} → requer_conta`, acessoAssessoria(r) === 'requer_conta', acessoAssessoria(r));
// Papéis internos que NÃO são cliente caem no mesmo balde. Está assim de propósito? O efeito
// prático é um só: `api/assinar-contrato.js` recusa a assinatura deles (o Checkout só barra quem
// está deslogado). Fica travado aqui para que mudar isso seja uma decisão, não um acidente.
for (const r of ['consultor', 'parceiro'])
  checa(`${r} → requer_conta (papel interno, não é cliente)`, acessoAssessoria(r) === 'requer_conta', acessoAssessoria(r));

console.log('\nQUEM PODE CONTRATAR');
checa('explorador → pode (06/10: não exige mais o Investidor Pro)', acessoAssessoria('explorador') === 'pode', acessoAssessoria('explorador'));
for (const r of ['top2', 'assessorado'])
  checa(`${r} → pode`, acessoAssessoria(r) === 'pode', acessoAssessoria(r));
checa('top2_anual também pode (era o buraco da lista literal do Checkout)', acessoAssessoria('top2_anual') === 'pode');
checa('assessorado_anual também pode', acessoAssessoria('assessorado_anual') === 'pode');
for (const r of ['admin', 'analista', 'advogado', 'suporte'])
  checa(`equipe ${r} → pode`, acessoAssessoria(r) === 'pode');

console.log('\nLEILÃO CLUB NÃO CONTRATA AVULSA — JÁ TEM INCLUÍDA');
for (const r of ['clube', 'clube_anual'])
  checa(`${r} → incluido (nem "pode" nem "requer_conta")`, acessoAssessoria(r) === 'incluido', acessoAssessoria(r));
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

console.log('\nA TELA DE PLANOS NÃO COBRA MAIS O PRO — E NÃO ESCONDE O PREÇO');
{
  const planos = readFileSync(new URL('../../src/pages/Planos.jsx', import.meta.url), 'utf8');
  // A regra velha escondia o preço do explorador e trocava a CTA por "Seja Investidor Pro para
  // contratar". Os dois precisam ter sumido, senão a tela promete uma exigência que não existe.
  checa('sumiu o rótulo de exclusividade do Pro', !planos.includes('Exclusivo para Investidor Pro'));
  checa('sumiu a CTA que mandava virar Pro', !planos.includes('Seja Investidor Pro para contratar'));
  checa('o preço da assessoria é renderizado para todo mundo', /<PrecoComercial planoKey="assessorado"/.test(planos));
  checa('a tela não ramifica mais por requer_pro', !/requer_pro/.test(planos));
  // O que a tela AINDA precisa distinguir: Leilão Club já tem incluída e não contrata avulsa.
  checa('Leilão Club continua barrado com "Incluído no seu plano"', planos.includes('Incluído no seu plano'));
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
// Piso de asserções: se o arquivo for editado e passar a rodar menos do que declara, isso é
// reprovação — "não mediu" não pode sair como "passou" (mesma lição do verificar:schema).
if (ok + falhas < 28) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
