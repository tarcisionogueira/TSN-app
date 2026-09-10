/**
 * scripts/testes/escopo-reduzido-nao-vira-regressao-da-fonte.mjs
 *
 * POR QUE EXISTE (10/09). Investigando a "revisão geral dos scrapers" pedida pelo dono,
 * `fonte_regressao_suspeita()` acusava GESTAOLEILOES com total=1 contra piso aprendido de 63 —
 * mas o log real da execução (workflow_dispatch de 09/09) mostrou `GESTAO_DOMINIOS=
 * granadoleiloes.com.br` (1 dos 5 domínios do cluster) e `GESTAO_MAX_EVENTOS=2` (padrão 25):
 * um teste pontual, não uma medição de produção. `registrarSaude` comparou esse total contra
 * o histórico de escopo CHEIO e gravou `status='degradado'` — a mesma etiqueta `estrategia:
 * 'principal'` de qualquer coleta de verdade. O dia anterior (08/09) tinha 123 lotes saudáveis;
 * o site nunca quebrou.
 *
 * Fix: `estrategia` ganha o sufixo `-escopo-reduzido` quando o coletor sabe que rodou cortado
 * (scraper-gestao.mjs). Este teste tranca o reconhecimento do sufixo — a mesma função que
 * `_saude-fonte.mjs` usa para excluir essas linhas da comparação (`registrarSaude`) e que a
 * migration espelha em SQL (`fonte_baseline_aprendida`/`fonte_regressao_suspeita`).
 */
import { ehEscopoReduzido } from '../_saude-fonte.mjs';

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\nehEscopoReduzido — reconhece o sufixo sem confundir com estratégias normais');
{
  ok(ehEscopoReduzido('principal-escopo-reduzido') === true, 'sufixo presente: reconhecido');
  ok(ehEscopoReduzido('PRINCIPAL-ESCOPO-REDUZIDO') === true, 'caixa alta não escapa');
  ok(ehEscopoReduzido('principal') === false, "'principal' puro (23 fontes usam) NUNCA é confundido com escopo reduzido");
  ok(ehEscopoReduzido('soleon') === false, "estratégia de OUTRO coletor (ex.: SOLEON) não é afetada");
  ok(ehEscopoReduzido('leilaoindex') === false, 'idem para qualquer outra das ~19 estratégias em uso');
  ok(ehEscopoReduzido(null) === false, 'null não quebra nem confunde');
  ok(ehEscopoReduzido(undefined) === false, 'undefined idem');
  ok(ehEscopoReduzido('') === false, 'string vazia idem');
  ok(ehEscopoReduzido('escopo-reduzido') === true, 'funciona mesmo sem o prefixo principal- (só o sufixo importa)');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
