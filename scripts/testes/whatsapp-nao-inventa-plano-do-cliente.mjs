/**
 * npm run testar:whatsapp — a mensagem nunca afirma um plano que o cliente não tem.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ESTE TESTE NASCEU DE UM DEFEITO QUE CHEGOU AO CLIENTE, em 01/09, com o dono enviando os
 * convites um a um: o Matheus, que é **assessorado**, recebeu "Você é assinante do Investidor
 * Pro". A frase existe justamente para provar que não é disparo em massa — e, errada, prova
 * o contrário com mais força do que se não existisse.
 *
 * A CAUSA: `montarMensagem` recebia um BOOLEANO (`pagante`) e cravava o nome do plano no
 * texto. Mas "pagante" é `top2` OU `assessorado` OU `clube` — um booleano não carrega QUAL.
 * A RPC `whatsapp_fila_live` já devolvia `role` desde sempre; o JS é que não lia.
 *
 * O QUE TORNA ISSO PARTICULARMENTE INSTRUTIVO: o mesmo arquivo já documentava a regra, e a
 * cumpria — na OUTRA metade da função. Para o não-pagante existe `nunca_analisou`, com um
 * comentário explicando que a linha pessoal só entra quando é verdade, porque para 3 das 76
 * pessoas ela seria falsa. O cuidado foi todo para um lado; do outro ficou uma frase fixa.
 * Saber a regra não basta: ela tem de estar TRAVADA nos dois ramos.
 */
import { montarMensagem } from '../../api/admin-whatsapp-fila.js';

const BASE = { nome: 'Fulano de Tal', quando: 'amanhã (quarta) às 19:00', link: 'https://x/aula' };
let ok = 0, falhas = 0;
const checa = (n, c, d = '') => c
  ? (ok++, console.log(`  ✓ ${n}`))
  : (falhas++, console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`));

const msg = (extra) => montarMensagem({ ...BASE, ...extra });

console.log('\n── 1. Cada plano é chamado pelo nome CERTO ──');
const t2 = msg({ pagante: true, role: 'top2' });
checa('top2 → Investidor Pro', t2.includes('assinante do Investidor Pro'));

const cl = msg({ pagante: true, role: 'clube' });
checa('clube → Leilão Club', cl.includes('membro do Leilão Club'));
// O nome oficial é "Leilão Club", sem o 'e' — `_webhook-core.js` registra isso.
checa('clube NÃO é chamado de Investidor Pro', !cl.includes('Investidor Pro'));

const as = msg({ pagante: true, role: 'assessorado' });
checa('assessorado → cliente da assessoria', as.includes('cliente da assessoria'));
// ESTE É O CASO QUE VAZOU. Se voltar a falhar, voltou o defeito de 01/09.
checa('assessorado NÃO é chamado de Investidor Pro', !as.includes('Investidor Pro'), as.slice(0, 120));
// Assessoria não é assinatura de plano: chamá-lo de "assinante" já é impreciso.
checa('assessorado NÃO é chamado de "assinante"', !as.includes('assinante'));

console.log('\n── 2. Role desconhecido: cala sobre o plano, não chuta ──');
for (const [rot, role] of [['desconhecido', 'algo_novo'], ['nulo', null], ['ausente', undefined], ['vazio', '']]) {
  const m = msg({ pagante: true, role });
  const afirma = ['Investidor Pro', 'Leilão Club', 'assessoria', 'assinante'].filter((f) => m.includes(f));
  checa(`role ${rot} não afirma plano nenhum`, afirma.length === 0, `afirmou: ${afirma.join(', ')}`);
  // Perder a linha pessoal é aceitável; afirmar errado não é. O convite tem de continuar de pé.
  checa(`role ${rot} ainda convida`, m.includes('antes de abrir para o resto'));
}

console.log('\n── 3. Não-pagante nunca ouve falar de plano ──');
for (const nunca of [true, false]) {
  const m = msg({ pagante: false, nuncaAnalisou: nunca });
  const afirma = ['Investidor Pro', 'Leilão Club', 'assessoria', 'assinante'].filter((f) => m.includes(f));
  checa(`não-pagante (nuncaAnalisou=${nunca}) não menciona plano`, afirma.length === 0, afirma.join(', '));
}
// O outro ramo da MESMA regra, que já estava certo e precisa continuar: a linha pessoal do
// não-pagante só sai quando é verdade. Sem isso, "você ainda não rodou nenhuma análise" iria
// para quem já rodou — o mesmo defeito, do outro lado da função.
checa('nuncaAnalisou=true afirma que não rodou análise',
  msg({ pagante: false, nuncaAnalisou: true }).includes('ainda não chegou a rodar nenhuma análise'));
checa('nuncaAnalisou=false NÃO afirma isso',
  !msg({ pagante: false, nuncaAnalisou: false }).includes('ainda não chegou a rodar'));

console.log('\n── 4. O básico que não pode quebrar ──');
checa('usa só o primeiro nome', msg({ pagante: true, role: 'top2' }).startsWith('Oi, Fulano!'));
checa('sem nome não quebra', msg({ nome: '', pagante: true, role: 'top2' }).startsWith('Oi!'));
checa('o link entra', t2.includes('https://x/aula'));
// Preço no convite transforma conversa em anúncio — decisão registrada no próprio arquivo.
checa('não fala de preço', !/R\$|\bpreço\b|\bvalor de\b/i.test(t2));
const semCidade = msg({ pagante: false, nuncaAnalisou: true });
checa('sem cidade, pede a cidade', semCidade.includes('Me diz a sua cidade'));
const comCidade = msg({ pagante: false, nuncaAnalisou: true, cidade: 'Salvador', uf: 'BA' });
checa('com cidade, confirma a cidade', comCidade.includes('Salvador/BA'));

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 22) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
