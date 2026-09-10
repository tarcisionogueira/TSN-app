/**
 * scripts/testes/quem-nao-abre-4-emails-vira-mensal.mjs
 *
 * POR QUE EXISTE (10/09). O dono pediu: "quem não abre os e-mails, reduza a frequência para
 * 1x/mês". A régua (`precisaPisoMensal`) decide isso a partir de `alertas_engajamento_lote`
 * (últimos 4 envios de fato, não 4 semanas de calendário). Duas formas de errar, ambas
 * silenciosas: contar quem ainda não teve 4 envios (pune gente que nunca teve chance de
 * abrir) e contar quem abriu QUALQUER um dos 4 (reclassificaria "abre pouco" como "não abre
 * nunca"). A função é IMPORTADA do cron, nunca reproduzida aqui.
 */
import { precisaPisoMensal } from '../../api/enviar-alertas-cron.js';

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\nprecisaPisoMensal — só quem tem amostra cheia (4) e ZERO abertura');
{
  ok(precisaPisoMensal(undefined) === false, 'sem registro de engajamento (usuário novo): não pune — segue semanal');
  ok(precisaPisoMensal(null) === false, 'null: mesmo caso, não pune');
  ok(precisaPisoMensal({ enviados_recentes: 0, abertos_recentes: 0 }) === false, '0 enviados: amostra vazia, não pune');
  ok(precisaPisoMensal({ enviados_recentes: 1, abertos_recentes: 0 }) === false, '1 enviado sem abrir: amostra pequena demais, ainda semanal');
  ok(precisaPisoMensal({ enviados_recentes: 3, abertos_recentes: 0 }) === false, '3 de 4 sem abrir: ainda não fechou a amostra mínima');
  ok(precisaPisoMensal({ enviados_recentes: 4, abertos_recentes: 0 }) === true, '4 enviados, 0 abertos: piso mensal');
  ok(precisaPisoMensal({ enviados_recentes: 5, abertos_recentes: 0 }) === true, '5 enviados (usuário antigo), 0 abertos: piso mensal');
  ok(precisaPisoMensal({ enviados_recentes: 4, abertos_recentes: 1 }) === false, '4 enviados, 1 aberto: abriu pelo menos uma vez — continua semanal');
  ok(precisaPisoMensal({ enviados_recentes: 4, abertos_recentes: 4 }) === false, '4 enviados, todos abertos: engajado, continua semanal');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
