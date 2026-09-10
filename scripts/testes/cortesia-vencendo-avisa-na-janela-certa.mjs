/**
 * scripts/testes/cortesia-vencendo-avisa-na-janela-certa.mjs
 *
 * POR QUE EXISTE (10/09). O aviso de conversão do plano de cortesia (curso → N meses de
 * Investidor Pro) só faz sentido dentro de uma janela: cedo demais e a pessoa esquece antes
 * de decidir; depois do vencimento o e-mail chegaria prometendo algo que já acabou. Um erro
 * de um dia na fórmula é exatamente a classe de bug que este acervo já cometeu mais de uma vez
 * com contagem de dias — por isso a régua real (`dentroDaJanela`) é IMPORTADA do cron, nunca
 * reproduzida aqui: regra copiada só funciona enquanto as cópias forem idênticas.
 */
import { dentroDaJanela, corpo } from '../../api/aviso-cortesia-vencendo-cron.js';

const DIA = 86400000;
const AGORA = Date.parse('2026-09-10T12:00:00Z');

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\nA JANELA DE DIAS — nem cedo demais, nem depois de vencer');
{
  ok(dentroDaJanela(AGORA + 4 * DIA, AGORA) === false, '4 dias antes: cedo demais, não avisa');
  ok(dentroDaJanela(AGORA + 5 * DIA, AGORA) === true,  '5 dias antes: começa a janela');
  ok(dentroDaJanela(AGORA + 6 * DIA, AGORA) === true,  '6 dias antes: dentro da janela');
  ok(dentroDaJanela(AGORA + 7 * DIA, AGORA) === true,  '7 dias antes: fim da janela');
  ok(dentroDaJanela(AGORA + 8 * DIA, AGORA) === false, '8 dias antes: ainda não — a régua re-tenta amanhã');
  ok(dentroDaJanela(AGORA - 1 * DIA, AGORA) === false, 'já venceu ontem: não avisa (isso é rebaixamento, não aviso prévio)');
  ok(dentroDaJanela(AGORA, AGORA) === false, 'vence agora mesmo: fora da janela de aviso prévio');
  ok(dentroDaJanela(NaN, AGORA) === false, 'data inválida nunca entra (falha fechada)');
}

console.log('\nARREDONDAMENTO — quem falta poucas HORAS não pode cair fora por causa do Math.ceil');
{
  // 4 dias e 23h faltando arredonda para 5 dias inteiros (Math.ceil) — é a pessoa que MAIS
  // precisa do aviso, e um corte em "dias inteiros" mal feito a excluiria por horas.
  ok(dentroDaJanela(AGORA + 4 * DIA + 23 * 3600000, AGORA) === true, '4d23h antes arredonda para 5 e entra na janela');
  // 7 dias e 1 minuto passa de 7 dias inteiros e arredonda para 8 — fica fora, de propósito.
  ok(dentroDaJanela(AGORA + 7 * DIA + 60000, AGORA) === false, '7d e 1min antes arredonda para 8 e fica fora');
}

console.log('\nO CORPO DO E-MAIL — o que a pessoa precisa ver para decidir');
{
  const html = corpo({
    nome: 'Maria da Silva',
    planoNome: 'Investidor Pro',
    planoPreco: 'R$ 49,90',
    dataFmt: '15/09/2026',
    checkoutUrl: 'https://bidprobrasil.com.br/api/clique?u=abc&t=cortesia_vencendo&p=xyz&s=123',
    unsubUrl: 'https://bidprobrasil.com.br/api/cancelar-alertas?token=abc.def',
  });
  ok(html.includes('Maria'), 'saúda pelo primeiro nome');
  ok(html.includes('Investidor Pro'), 'nomeia o plano que está vencendo');
  ok(html.includes('R$ 49,90/mês'), 'mostra o preço real de continuar (vem do banco, nunca fixo no texto)');
  ok(html.includes('15/09/2026'), 'mostra a data em que o acesso termina');
  ok(html.includes('cortesia_vencendo'), 'o link de checkout carrega o rastreio da campanha');
  ok(html.includes('cancelar-alertas?token=abc.def'), 'tem link de descadastro (e-mail de conversão não é transacional puro)');
  ok(!html.includes('undefined') && !html.includes('null'), 'nenhum campo vazio vaza como texto literal na tela do cliente');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
