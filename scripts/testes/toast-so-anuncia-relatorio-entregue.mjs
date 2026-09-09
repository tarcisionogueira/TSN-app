/**
 * npm run testar:entrega — o "Pronto!" só sai quando o relatório FOI ENTREGUE.
 *
 * Este defeito já reincidiu DUAS vezes, sempre com a mesma assinatura: um estado intermediário
 * que o servidor grava como `status:'concluida'` de propósito, e um leitor que trata status
 * como sinônimo de entrega.
 *   07/08 (Cotia)      — documental 'concluida' com precisaDocumentos ainda true.
 *   09/09 (Vila Velha) — mercado 'concluida' com o parecer VAZIO (parecerPendente). A correção
 *                        de 07/08 tinha criado ramo para 'documental' e 'laudo' e terminado em
 *                        `return true`; 'mercado' caiu no default permissivo.
 *
 * Por isso o teste vigia DUAS coisas, e a segunda é a que impede a terceira vez:
 *   (1) a regra em si, incluindo o caso exato de produção;
 *   (2) que continue existindo UMA regra só — nenhuma tela pode reimplementá-la.
 */
import { readFileSync } from 'node:fs';
import { faltaNoRelatorio, relatorioEntregue } from '../../src/lib/entrega-relatorio.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nO CASO REAL DE 09/09 — mercado concluído com o parecer em branco');
{
  // Rastro do banco: atividade_log 13:23:02 "Entrega incompleta: mercado OK (R$ 467.100) mas
  // SEM parecer — motivo: This operation was aborted". A linha ficou 'concluida'.
  const a = { status: 'concluida', result: { valorMercado: 467100, parecer: '', parecerPendente: true } };
  checa('não é entregue', !relatorioEntregue('mercado', a));
  checa('o motivo é o parecer', faltaNoRelatorio('mercado', a) === 'parecer', faltaNoRelatorio('mercado', a));
}
checa('parecer só com espaços também não é parecer',
  !relatorioEntregue('mercado', { status: 'concluida', result: { valorMercado: 1, parecer: '   \n ' } }));
checa('sem a flag, parecer vazio ainda é incompleto (a flag pode não ter sido gravada)',
  !relatorioEntregue('mercado', { status: 'concluida', result: { valorMercado: 1, parecer: '' } }));
checa('parecer escrito → entregue',
  relatorioEntregue('mercado', { status: 'concluida', result: { valorMercado: 1, parecer: 'Parecer completo.' } }));

console.log('\nmercadoVazio É ENTREGA LEGÍTIMA — não confundir fallback com falha');
checa('valor pelo Índice BidPro, sem comparáveis → entregue',
  relatorioEntregue('mercado', { status: 'concluida', result: { mercadoVazio: true, parecer: '' } }));

console.log('\nOS OUTROS DOIS TIPOS — o gate de 07/08 continua valendo');
checa('documental ainda capturando documentos → não entregue',
  !relatorioEntregue('documental', { status: 'concluida', result: { precisaDocumentos: true } }));
checa('documental com documentos → entregue',
  relatorioEntregue('documental', { status: 'concluida', result: {} }));
checa('laudo esperando os relatórios-base → não entregue',
  !relatorioEntregue('laudo', { status: 'concluida', result: { precisaRelatorios: true } }));
checa('laudo pronto → entregue',
  relatorioEntregue('laudo', { status: 'concluida', result: {} }));

console.log('\nESTADOS QUE NUNCA SÃO "PRONTO"');
for (const st of ['gerando', 'erro', undefined, null, 'fila'])
  checa(`status ${JSON.stringify(st)} → não entregue`, !relatorioEntregue('mercado', { status: st, result: { parecer: 'x' } }));
checa('análise inexistente → não entregue', !relatorioEntregue('mercado', null));
checa('concluída SEM result → não entregue (era um falso "Pronto!" latente)',
  !relatorioEntregue('mercado', { status: 'concluida', result: null }));

console.log('\nO DEFAULT É NEGATIVO — foi o default permissivo que deixou o mercado passar');
checa('tipo desconhecido não é entregue por omissão',
  !relatorioEntregue('relatorio-que-ainda-nao-existe', { status: 'concluida', result: {} }));
checa('e o motivo diz que é desconhecido, não que está pronto',
  faltaNoRelatorio('relatorio-que-ainda-nao-existe', { status: 'concluida', result: {} }) === 'tipo-desconhecido');

console.log('\nUMA REGRA SÓ — nenhuma tela pode reimplementar a decisão de entrega');
{
  const toast = readFileSync(new URL('../../src/components/ToastRelatorioPronto.jsx', import.meta.url), 'utf8');
  checa('o toast importa a regra', /from '\.\.\/lib\/entrega-relatorio'/.test(toast));
  for (const campo of ['precisaDocumentos', 'precisaRelatorios', 'parecerPendente', 'mercadoVazio'])
    checa(`o toast não lê ${campo} por conta própria`, !toast.includes(campo), campo);
  checa('e não sobrou nenhum `return true` de gate no toast',
    !/const entregue = \(/.test(toast), 'gate local reapareceu');

  const analise = readFileSync(new URL('../../src/pages/Analise.jsx', import.meta.url), 'utf8');
  checa('a tela importa a regra', /from '\.\.\/lib\/entrega-relatorio'/.test(analise));
  checa('a tela não recalcula a incompletude do mercado',
    !/result\?\.parecerPendente\s*===/.test(analise));
  checa('a tela não recalcula a entrega do documental',
    !/status === 'concluida' && !\w+\?\.result\?\.precisaDocumentos/.test(analise));
  checa('a tela não recalcula a entrega do laudo',
    !/status === 'concluida' && !\w+\?\.result\?\.precisaRelatorios/.test(analise));
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 27) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
