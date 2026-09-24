/**
 * npm run testar:cadencia — a frequência do e-mail de oportunidades segue o SEGMENTO
 * (api/_cadencia.js, pedido do dono 24/09): pagante semanal, assessorado quinzenal, novo
 * semanal, gratuito ativo quinzenal com 6 itens, inativo mensal, pausado a cada 60 dias.
 */
import { segmentoCadencia, cedoDemais, podeRecorrenteHoje, cabeNoOrcamento, PADRAO } from '../../api/_cadencia.js';
import { ehCampanha } from '../../api/_email.js';

let falhas = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { falhas++; console.log(`  ✗ ${m}`); } };
const AGORA = Date.parse('2026-09-28T11:00:00Z');
const dias = (n) => new Date(AGORA - n * 86400000).toISOString();
const antigo = dias(120);

console.log('\nSEGMENTOS');
ok(segmentoCadencia({ role: 'top2', created_at: antigo }, null, PADRAO, AGORA).dias === 7, 'Investidor Pro: semanal');
ok(segmentoCadencia({ role: 'assessorado', created_at: antigo }, null, PADRAO, AGORA).dias === 14, 'assessorado: quinzenal');
ok(segmentoCadencia({ role: 'explorador', created_at: dias(5) }, null, PADRAO, AGORA).segmento === 'novo', 'conta de 5 dias: novo (semanal)');
const ativo = segmentoCadencia({ role: 'explorador', created_at: antigo }, { ultima_atividade: dias(3) }, PADRAO, AGORA);
ok(ativo.segmento === 'ativo' && ativo.dias === 14 && ativo.itens === 6, 'gratuito que usou o site há 3 dias: quinzenal com 6 itens');
ok(segmentoCadencia({ role: 'explorador', created_at: antigo }, { ultimo_clique: dias(10) }, PADRAO, AGORA).segmento === 'ativo', 'clique no e-mail há 10 dias também conta como ativo');
ok(segmentoCadencia({ role: 'explorador', created_at: antigo }, { ultima_atividade: dias(45), enviados_ult7: 5, abertos_ult7: 0 }, PADRAO, AGORA).dias === 28, 'inativo com 5 envios sem abrir: mensal (amostra de pausa ainda não fecha)');
ok(segmentoCadencia({ role: 'explorador', created_at: antigo }, { enviados_ult7: 7, abertos_ult7: 0 }, PADRAO, AGORA).dias === 60, '7 envios seguidos sem abrir: pausado (60 dias)');
ok(segmentoCadencia({ role: 'explorador', created_at: antigo }, { enviados_ult7: 7, abertos_ult7: 1 }, PADRAO, AGORA).dias === 28, 'uma abertura em 7 tira da pausa');
ok(segmentoCadencia({ role: 'top2', created_at: antigo }, { enviados_ult7: 7, abertos_ult7: 0 }, PADRAO, AGORA).dias === 7, 'pagante NUNCA é pausado');
ok(segmentoCadencia({ role: 'explorador', created_at: antigo }, null, { ...PADRAO, inativo: 21 }, AGORA).dias === 21, 'número vem da configuração (app_config), não do código');

console.log('\nRELÓGIO (cron diário às 11h)');
ok(!cedoDemais(dias(7), 7, AGORA), 'semanal: 7 dias depois pode');
ok(!cedoDemais(new Date(AGORA - (7 * 24 - 1) * 3600000).toISOString(), 7, AGORA), 'semanal: 1 h "antes" dos 7 dias ainda pode (folga do cron)');
ok(cedoDemais(dias(7), 14, AGORA), 'quinzenal: 7 dias depois NÃO pode');
ok(!cedoDemais(null, 14, AGORA), 'nunca enviado: pode');

console.log('\nTETO DE 100/DIA (o que não coube sai no próximo dia útil)');
ok(podeRecorrenteHoje(Date.parse('2026-09-28T11:00:00Z')) && podeRecorrenteHoje(Date.parse('2026-09-29T11:00:00Z')), 'segunda e terça: recorrente pode sair (terça pega o que o teto de segunda deixou)');
ok(!podeRecorrenteHoje(Date.parse('2026-09-26T11:00:00Z')) && !podeRecorrenteHoje(Date.parse('2026-09-27T11:00:00Z')), 'sábado e domingo: não');
ok(cedoDemais(dias(1), 7, AGORA), 'quem recebeu na segunda NÃO recebe de novo na terça');
ok(cabeNoOrcamento('explorador', 26, PADRAO) && !cabeNoOrcamento('inativo', 25, PADRAO), 'gratuito para com 25 restantes (15 transacionais + 10 do pagante)');
ok(cabeNoOrcamento('pagante', 25, PADRAO) && cabeNoOrcamento('assessorado', 16, PADRAO), 'pagante/assessorado usam a reserva do pagante');
ok(!cabeNoOrcamento('pagante', 15, PADRAO), 'ninguém do cron come os 15 do transacional (relatório pronto, suporte)');
ok(!cabeNoOrcamento('pagante', 0, PADRAO), 'leitura do orçamento falhou (0): não envia');

console.log('\nO QUE É CAMPANHA (limite semanal em api/_email.js)');
ok(ehCampanha('divulgacao_produto') && ehCampanha('convite_live') && ehCampanha('lancamento_vespera'), 'divulgação, convite de live e lançamento são campanha');
ok(!ehCampanha('live_lembrete_vespera') && !ehCampanha('boas_vindas') && !ehCampanha('oportunidades'), 'lembrete a inscrito, boas-vindas e oportunidades NÃO são limitados');

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
