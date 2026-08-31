/**
 * scripts/testes/orcamento-nao-e-falha-da-fonte.mjs — recusa de ORÇAMENTO nunca vira
 * "a fonte quebrou".
 *
 * POR QUE EXISTE (31/08). É a forma #5 do CLAUDE.md, e ela já voltou QUATRO vezes: 14–16/08
 * (CALIL, VEGAS, TORRES3, RJLEILOES marcadas como quebradas sem nunca terem sido consultadas),
 * 18/08 (a consulta do ritual comparando `sem_cota` contra o piso aprendido), 27/08 (cota que
 * acabou no MEIO da coleta saindo como 'ok' com total truncado) e 30/08 (RJLEILOES gravando
 * `status='falhou'` com o motivo dizendo `teto_global` por extenso).
 *
 * A causa da última foi descompasso branch × main — o workflow roda em `main` e o conserto do
 * `semCota` ainda estava na branch. Mas a causa PROFUNDA é estrutural: a flag booleana
 * atravessa `ErroBrightData` → `FalhaDeAcesso` → `throw` → `.catch()` do `main()`, e cada um
 * dos ~15 coletores reconstrói essa cadeia por conta própria. Perder um argumento em UM deles
 * basta, e o sintoma é um alarme que manda consertar parser INTACTO.
 *
 * A classificação, porém, acontece num lugar só: `registrarSaude`. Então é lá que a defesa
 * mora — o texto do motivo desempata quando a flag se perde. Este teste tranca as duas metades:
 * o que TEM de virar 'sem_cota' e, igualmente importante, o que NÃO pode (falha de verdade
 * continua sendo 'falhou', senão a rede de segurança vira mordaça).
 */
import { motivoEhOrcamento } from '../_saude-fonte.mjs';

const casos = [
  // ── recusa de ORÇAMENTO: tem de ser reconhecida mesmo sem a flag ───────────────────────
  ['falha de acesso: teto_global',                          true,  'o caso medido em 30/08 (RJLEILOES)'],
  ['falha de acesso: subcota',                              true,  'sub-cota semanal do propósito'],
  ['falha de acesso: subcota_dia',                          true,  'rateio diário (18/08)'],
  ['falha de acesso: reservado_para_outros',                true,  'reserva de outro propósito'],
  ['falha de acesso: cota_indisponivel',                    true,  'contador fora do ar — também é "não gastei"'],
  ['SEM COTA Bright Data — coleta não tentada',             true,  'texto que os coletores escrevem à mão'],
  ['sem_cota',                                              true,  'o motivo cru'],
  ['TETO_GLOBAL',                                           true,  'caixa alta não pode escapar'],

  // ── falha DE VERDADE: não pode ser silenciada como orçamento ───────────────────────────
  ['falha de acesso: http',                                 false, 'HTTP de erro é a fonte respondendo errado'],
  ['falha de acesso: detalhes_inacessiveis',                false, 'lotes sem detalhe — coleta quebrada'],
  ['falha de acesso: corpo_ilegivel',                       false, 'resposta ilegível'],
  ['falha de acesso: residencial',                          false, 'nem fetch nem Chromium trouxeram a página'],
  ['falha de acesso: rede',                                 false, 'erro de rede NÃO é decisão de orçamento'],
  ['falha de acesso: sem_config',                           false, 'credencial ausente é configuração, não teto'],
  ['falha de acesso: supabase',                             false, 'erro de banco'],
  ['listagem lida, zero lotes',                             false, 'constatação da fonte'],
  ['todos reprovados na qualidade (12)',                    false, 'portão de qualidade'],
  ['queda vs anterior (coletados 3<40)',                    false, 'regressão de verdade'],
  ['enumeração incompleta (paginação interrompida)',        false, 'paginação truncada'],
  ['',                                                      false, 'motivo vazio'],
  [null,                                                    false, 'motivo nulo'],
  [undefined,                                               false, 'motivo ausente'],
  // A armadilha do `includes` solto: estas PARECEM, e não são.
  ['falha ao ler a cotacao do imovel',                      false, '"cotacao" contém "cota" e NÃO é recusa de orçamento'],
  ['erro na subcotacao de area',                            false, 'palavra maior que engloba o token'],
];

let mau = 0;
for (const [motivo, esperado, oque] of casos) {
  const obtido = motivoEhOrcamento(motivo);
  const ok = obtido === esperado;
  if (!ok) mau++;
  console.log(`${ok ? '  ok  ' : '  FALHOU '} ${JSON.stringify(motivo)} → ${obtido} (esperado ${esperado}) · ${oque}`);
}

if (mau) {
  console.error(`\n❌ ${mau} caso(s) fora do esperado em motivoEhOrcamento.`);
  process.exit(1);
}
console.log(`\n✅ ${casos.length} casos: recusa de orçamento e falha da fonte seguem separadas.`);
