/**
 * npm run testar:whatsapp — a mensagem nunca afirma nada falso sobre quem a lê.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * QUATRO DEFEITOS EM PRODUÇÃO NUM DIA SÓ (01/09), todos no mesmo texto, nenhum dando erro:
 *
 *  1. **O assessorado foi chamado de "assinante do Investidor Pro".** O nome do plano estava
 *     chumbado no texto e "pagante" é `top2` OU `assessorado` OU `clube` — um booleano não
 *     carrega QUAL. A RPC já devolvia `role`; o JS é que não lia.
 *
 *  2. **"Antes de abrir para o resto".** Uma assinante respondeu perguntando *"Quem é o
 *     resto?"*. A frase não tinha referente e só era elogiosa POR COMPARAÇÃO — para elogiar
 *     quem lia, precisava de alguém embaixo.
 *
 *  3. **Dois textos para NOVE roles.** `consultor`, `analista` e `advogado` não são excluídos
 *     da fila (só `admin` é) e recebiam a mensagem de quem se cadastrou e nunca rodou uma
 *     análise. E `whatsapp_fila_live` classificava como pagante `top2_anual`,
 *     `assessorado_anual` e `clube_anual` — **três valores que o CHECK de `perfis.role` não
 *     admite**: testes que liam como cobertura e não cobriam nada.
 *
 *  4. **O pior, e o que atingiu quase todos:** o JS lia `p.nunca_analisou` e a RPC NUNCA
 *     devolveu essa coluna. `undefined === true` é `false`, então a linha pessoal do
 *     explorador nunca apareceu em mensagem nenhuma. Medido na fila viva no dia do conserto:
 *     **64 de 66 pessoas** deveriam tê-la recebido.
 *
 * O QUE ESTE ARQUIVO TRAVA, e é a regra única por trás dos quatro: **toda frase que afirma
 * algo sobre a pessoa tem de ser verdade, e tem de SUMIR quando não puder ser.** Perder a
 * linha pessoal custa menos do que afirmar errado — é justamente ela que prova que a mensagem
 * não é disparo em massa, e errada ela prova o contrário com mais força.
 */
import { montarMensagem, montarMensagemGrupo, quandoPorExtenso } from '../../api/admin-whatsapp-fila.js';

const BASE = { nome: 'Fulano de Tal', quando: 'amanhã (quarta), às 19h', link: 'https://x/aula' };
let ok = 0, falhas = 0;
const checa = (n, c, d = '') => c
  ? (ok++, console.log(`  ✓ ${n}`))
  : (falhas++, console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`));

const msg = (extra) => montarMensagem({ ...BASE, ...extra });

// O que `planos_config` de fato contém hoje (medido em 01/09). Cada linha é role → o que a
// fila devolve. `top1` está no CHECK de `perfis.role` e NÃO tem plano: cai no neutro de
// propósito, e é o caso que prova que role novo não vira afirmação errada.
const PUBLICOS = [
  ['top2',        'cliente',  'assinante do Investidor Pro'],
  ['assessorado', 'cliente',  'cliente da assessoria'],
  ['clube',       'cliente',  'membro do Leilão Club'],
  ['consultor',   'parceiro', 'consultor parceiro'],
  ['advogado',    'parceiro', 'advogado parceiro'],
  ['analista',    'equipe',   'do time'],
  ['explorador',  'gratuito', null],
  ['top1',        null,       null],
];
const TODAS = [
  ...PUBLICOS.map(([role, publico, tratamento]) =>
    [`${role} (${publico || 'sem público'})`, msg({ publico, tratamento })]),
  ['explorador que nunca analisou', msg({ publico: 'gratuito', tratamento: null, nuncaAnalisou: true })],
  ['explorador com cidade', msg({ publico: 'gratuito', nuncaAnalisou: true, cidade: 'Salvador', uf: 'BA' })],
  ['público inventado', msg({ publico: 'coisa_nova', tratamento: 'rei da cocada' })],
];

console.log('\n── 1. Cada plano é chamado pelo nome CERTO, e só o dele ──');
const AFIRMACOES = ['Investidor Pro', 'Leilão Club', 'assessoria', 'assinante', 'parceiro', 'do time'];
for (const [role, publico, tratamento] of PUBLICOS) {
  const m = msg({ publico, tratamento });
  if (tratamento) {
    checa(`${role} → "${tratamento}"`, m.includes(`Como você é ${tratamento}`), m.slice(0, 110));
    // O CASO QUE VAZOU: o assessorado sendo chamado de assinante do Investidor Pro. Se
    // qualquer role passar a afirmar o plano de outro, é o defeito de 01/09 de volta.
    const alheias = AFIRMACOES.filter((f) => !tratamento.includes(f) && m.includes(f));
    checa(`${role} não afirma o plano de outro`, alheias.length === 0, `afirmou: ${alheias.join(', ')}`);
  } else {
    // Sem tratamento não se inventa um. Isto cobre o explorador (de propósito sem tratamento:
    // "Como você é explorador" nomeia a pessoa pelo plano gratuito dela na primeira linha) e
    // o `top1`, que é role sem plano nenhum.
    const afirmou = AFIRMACOES.filter((f) => m.includes(f));
    checa(`${role} não afirma plano nenhum`, afirmou.length === 0, `afirmou: ${afirmou.join(', ')}`);
    checa(`${role} não escreve "Como você é" vazio`, !/Como você é\s*[,.]/.test(m) && !/undefined|null/.test(m), m.slice(0, 110));
  }
}
// Público reconhecido SEM tratamento (plano novo cadastrado pela metade): a abertura perde a
// linha do plano e o resto continua de pé. Nunca "Como você é undefined".
const semTrato = msg({ publico: 'cliente', tratamento: null });
checa('cliente sem tratamento não quebra a frase', !/undefined|null|Como você é\s*[,q]/.test(semTrato), semTrato.slice(0, 110));
checa('cliente sem tratamento ainda convida', /Quis te chamar pessoalmente/.test(semTrato), semTrato.slice(0, 110));

console.log('\n── 2. Cada público recebe o texto DELE, e não o de outro ──');
// O DEFEITO Nº 3: um advogado parceiro recebendo "você se cadastrou e nunca rodou análise".
const parc = msg({ publico: 'parceiro', tratamento: 'advogado parceiro' });
checa('parceiro é tratado como par', parc.includes('quem você atende'), parc.slice(0, 200));
checa('parceiro NÃO ouve que nunca rodou análise', !parc.includes('não chegou a rodar'));
checa('parceiro NÃO ouve "a participação é gratuita"', !parc.includes('gratuita'));
const eq = msg({ publico: 'equipe', tratamento: 'do time' });
checa('equipe é tratada como equipe', eq.includes('algum cliente seu'), eq.slice(0, 200));
checa('equipe NÃO ouve que nunca rodou análise', !eq.includes('não chegou a rodar'));
const cli = msg({ publico: 'cliente', tratamento: 'assinante do Investidor Pro' });
checa('cliente é chamado pessoalmente', cli.includes('quis te chamar pessoalmente'));
checa('cliente NÃO ouve que nunca rodou análise', !cli.includes('não chegou a rodar'));

console.log('\n── 3. A linha do histórico só sai quando é verdade, e só para o gratuito ──');
// O DEFEITO Nº 4 é do lado SQL (a RPC não devolvia a coluna) e não dá para testar daqui — o
// que dá, e é o que impede o outro lado do mesmo erro, é que a linha só apareça quando o
// chamador de fato disser que é verdade. Se ela passar a sair com `nuncaAnalisou` ausente,
// voltamos a afirmar sobre a conta de quem já rodou dez análises.
checa('gratuito + nuncaAnalisou=true afirma que não rodou',
  msg({ publico: 'gratuito', nuncaAnalisou: true }).includes('ainda não chegou a rodar uma análise'));
checa('gratuito + nuncaAnalisou=false NÃO afirma',
  !msg({ publico: 'gratuito', nuncaAnalisou: false }).includes('ainda não chegou a rodar'));
checa('gratuito SEM o campo (o bug nº 4) NÃO afirma',
  !msg({ publico: 'gratuito' }).includes('ainda não chegou a rodar'));
// E ela nunca vale para quem NÃO é do plano gratuito, mesmo que o campo venha true: um
// assinante que ainda não rodou análise não precisa ouvir isso num convite.
for (const pub of ['cliente', 'parceiro', 'equipe', null]) {
  checa(`público ${pub || 'nenhum'} + nuncaAnalisou=true não usa a linha do gratuito`,
    !msg({ publico: pub, tratamento: 'x parceiro', nuncaAnalisou: true }).includes('não chegou a rodar'));
}

console.log('\n── 4. Nenhuma mensagem se elogia por comparação ──');
// O DEFEITO Nº 2, e a trava é sobre a FORMA: qualquer expressão que agrupe terceiros em bloco
// anônimo reintroduz a pergunta "quem é o resto?" com outras palavras.
const AGRUPAMENTO_ANONIMO = ['o resto', 'os outros', 'os demais', 'todo mundo', 'a galera', 'o pessoal', 'a massa'];
for (const [rot, m] of TODAS) {
  const achou = AGRUPAMENTO_ANONIMO.filter((f) => m.toLowerCase().includes(f));
  checa(`${rot}: não agrupa terceiros em bloco anônimo`, achou.length === 0, `usou: ${achou.join(', ')}`);
}

console.log('\n── 5. O básico que não pode quebrar, em TODAS as variações ──');
for (const [rot, m] of TODAS) {
  checa(`${rot}: usa só o primeiro nome`, m.startsWith('Oi, Fulano!'), m.slice(0, 40));
  checa(`${rot}: o link entra`, m.includes('https://x/aula'));
  // Preço no convite transforma conversa em anúncio — decisão registrada no próprio arquivo.
  checa(`${rot}: não fala de preço`, !/R\$|\bpreço\b|\bvalor de\b/i.test(m));
  // O invariante é "ao vivo" + "leilão": é o que faz a pessoa decidir se vale a hora dela.
  // A primeira versão desta asserção listava três frases exatas e reprovou o texto do
  // explorador, que diz a mesma coisa com outras palavras — a régua media a REDAÇÃO e
  // reportava com o nome de "diz o que vai acontecer".
  checa(`${rot}: diz que é ao vivo e sobre leilão`, /ao vivo/.test(m) && /leilão/i.test(m), m.slice(0, 200));
}
checa('sem nome não quebra', msg({ publico: 'cliente', tratamento: 'assinante do Investidor Pro', nome: '' }).startsWith('Oi!'));
const comCidade = msg({ publico: 'gratuito', nuncaAnalisou: true, cidade: 'Salvador', uf: 'BA' });
checa('com cidade, confirma a cidade', comCidade.includes('Salvador/BA'));
checa('sem cidade, pede a cidade', msg({ publico: 'gratuito', nuncaAnalisou: true }).includes('me diga a sua cidade'));

console.log('\n── 6. Horário se escreve como convite, não como formulário ──');
// ⚠️ A PRIMEIRA VERSÃO DESTA SEÇÃO MEDIU O PRÓPRIO FIXTURE: rodava o regex sobre uma mensagem
// nascida de `BASE.quando`, uma string escrita AQUI. Teria passado mudando só o fixture, com a
// função intacta — o instrumento medindo o que era mais fácil de coletar e reportando com o
// nome de outra coisa (forma nº 10, cometida dentro da própria verificação). Agora o alvo é a
// FUNÇÃO, com data real. A hora é lida em America/Bahia: 22:00Z é 19h lá.
const AULA = '2026-09-02T22:00:00Z';
const ANTES = Date.parse('2026-09-01T12:00:00Z');
const q = quandoPorExtenso(AULA, ANTES);
checa('minuto zerado não vira "19h00"', q.includes('19h') && !q.includes('19h00'), q);
checa('não sai no formato 19:00', !/\d{1,2}:\d{2}/.test(q), q);
checa('vírgula antes da hora', /,\s*às /.test(q), q);
// "amanhã" é conta de CALENDÁRIO, não de horas: às 23h de terça faltam 20 h e "amanhã" está
// certo; às 6h da quarta faltariam 13 h e "amanhã" estaria errado. Este par trava as duas.
checa('véspera diz amanhã', quandoPorExtenso(AULA, Date.parse('2026-09-01T23:30:00Z')).startsWith('amanhã'));
checa('no próprio dia diz hoje', quandoPorExtenso(AULA, Date.parse('2026-09-02T09:00:00Z')).startsWith('hoje'));
// Minuto que EXISTE tem de aparecer — senão a correção teria trocado ruído por erro.
checa('19h30 não some', quandoPorExtenso('2026-09-02T22:30:00Z', ANTES).includes('19h30'),
  quandoPorExtenso('2026-09-02T22:30:00Z', ANTES));
checa('a mensagem montada não traz 19:00', !/\d{1,2}:\d{2}/.test(cli), cli.slice(0, 140));

console.log('\n── 7. Convite pro GRUPO (09/09): nunca manda pra lugar nenhum, nunca afirma o que não sabe ──');
// A regra deste arquivo vale igual aqui: toda frase que afirma algo sobre a pessoa tem de ser
// verdade e SUMIR quando não for. O risco novo é outro e é pior — um convite sem link levaria
// a pessoa a lugar nenhum, então a função devolve `null` e a fila fica vazia com o motivo por
// extenso, em vez de gerar texto quebrado.
const GBASE = { nome: 'Fulana Silva', titulo: 'Leilão na prática', quando: 'amanhã (quarta), às 19h', linkGrupo: 'https://chat.whatsapp.com/XYZ' };
const gmsg = (extra) => montarMensagemGrupo({ ...GBASE, ...extra });

checa('sem link do grupo devolve null (não inventa destino)', montarMensagemGrupo({ ...GBASE, linkGrupo: null }) === null);
checa('sem link nem com string vazia gera texto', montarMensagemGrupo({ ...GBASE, linkGrupo: '' }) === null);
const g = gmsg();
checa('o link do grupo entra no texto', g.includes('https://chat.whatsapp.com/XYZ'));
checa('usa só o primeiro nome', g.startsWith('Oi, Fulana!'), g.slice(0, 40));
checa('sem nome não quebra', gmsg({ nome: '' }).startsWith('Oi!'));
checa('diz que a vaga já está confirmada (o fato que separa deste público)', /vaga.*confirmada/i.test(g), g.slice(0, 160));
// O motivo de entrar é o MECANISMO real (aviso e link da sala saem primeiro no grupo), não
// escassez inventada: "restam N vagas no grupo" seria número que ninguém pode conferir.
checa('dá um motivo real pra entrar', /link da sala|aviso/i.test(g), g.slice(0, 300));
checa('não inventa escassez', !/últimas? vagas?|restam? \d|só hoje|expira/i.test(g), g);
checa('não fala de preço', !/R\$|\bpreço\b/i.test(g));
// Campos ausentes não podem virar "undefined"/"null" na cara do inscrito — o mesmo defeito
// que a seção 1 trava para o plano, aqui vale para título, data e cidade.
for (const [rot, m] of [
  ['completo', g],
  ['sem título', gmsg({ titulo: null })],
  ['sem quando', gmsg({ quando: null })],
  ['sem título nem quando', gmsg({ titulo: null, quando: null })],
  ['com cidade', gmsg({ cidade: 'Vitória', uf: 'ES' })],
  ['sem cidade', gmsg({ cidade: null, uf: null })],
]) {
  checa(`${rot}: sem undefined/null no texto`, !/undefined|null/.test(m), m.slice(0, 160));
  checa(`${rot}: o link continua de pé`, m.includes('https://chat.whatsapp.com/XYZ'));
  checa(`${rot}: não agrupa terceiros em bloco anônimo`,
    AGRUPAMENTO_ANONIMO.filter((f) => m.toLowerCase().includes(f)).length === 0, m.slice(0, 200));
}
checa('com cidade, cita a cidade', gmsg({ cidade: 'Vitória', uf: 'ES' }).includes('Vitória/ES'));
checa('sem cidade, a frase não cita cidade nenhuma',
  !/em\s*\.|em\s*$/m.test(gmsg({ cidade: null, uf: null })), gmsg({ cidade: null, uf: null }).slice(-120));

console.log('\n── 7b. RODADAS (09/09): o dono chama a MESMA pessoa de novo, e o texto não pode repetir ──');
// Contexto real: ele chamou os 7 inscritos da edição às 17h41–17h48 e a fila zerou. O convite
// seguinte é o SEGUNDO para cada um. Exigência literal: "a mensagem não pode se repetir".
{
  const textos = [];
  for (let r = 0; r < 20; r += 1) textos.push(gmsg({ rodada: r, indice: 0 }));
  checa('20 convites à mesma pessoa → 20 textos distintos', new Set(textos).size === 20,
    `${new Set(textos).size} distintos`);
  checa('a rodada 4 não é cópia da rodada 0 (foi o defeito medido antes de subir)',
    textos[4] !== textos[0]);
  checa('todas as rodadas levam o link do grupo', textos.every((t) => t.includes(GBASE.linkGrupo)));
  checa('nenhuma rodada imprime undefined/null', textos.every((t) => !/undefined|null/.test(t)));
  checa('nenhuma rodada promete que é a última vez (o ciclo reabriria a promessa)',
    textos.every((t) => !/última vez|não insisto mais|nunca mais te chamo/i.test(t)));
  checa('nenhuma rodada inventa preço ou plano', textos.every((t) => !/R\$|desconto de \d|plano/i.test(t)));
  checa('nenhuma rodada inventa escassez', textos.every((t) => !/últimas vagas|restam \d|acaba em/i.test(t)));
  checa('só a 1ª rodada se apresenta (as seguintes já são conversa continuada)',
    textos.filter((t) => t.includes('Aqui é o Tarcísio')).length === 20 / 5);
  checa('alguma rodada fala das oportunidades do acervo (pedido do dono)',
    textos.some((t) => /abaixo da avalia|lotes/i.test(t)));
}
{
  // Pessoas diferentes, mesma rodada, mesmo minuto: o texto tem de sair diferente.
  const nomes = ['Francisca Bezerra', 'Raquel dos Santos', 'Thailane Carvalho', 'Dailson Siqueira'];
  const lote = nomes.map((nome, i) => gmsg({ nome, rodada: 1, indice: i }));
  checa('4 pessoas na mesma rodada → 4 textos distintos', new Set(lote).size === 4);
  checa('cada uma é chamada só pelo primeiro nome',
    lote.every((t, i) => t.includes(nomes[i].split(' ')[0]) && !t.includes(nomes[i].split(' ')[1])));
}
checa('rodada inválida não quebra nem repete a saudação errada',
  typeof gmsg({ rodada: -3, indice: 'x' }) === 'string');
checa('sem link, nenhuma rodada gera texto',
  [0, 1, 2, 3, 4].every((r) => gmsg({ linkGrupo: '', rodada: r }) === null));

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
// Piso de asserções: um `import` quebrado ou um laço que não roda deixaria o teste "passar"
// com zero verificações — sucesso por ausência de medição, que é o defeito que este arquivo
// inteiro existe para pegar.
if (ok + falhas < 113) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
