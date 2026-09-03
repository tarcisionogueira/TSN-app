/**
 * npm run testar:data-aula — a data anunciada da aula vem de `live_proxima`, nunca da coluna.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA PEGAR (03/09), e ele não dava erro em lugar nenhum.
 *
 * `eventos_live.data_hora` guarda a ocorrência ANTERIOR até `live_rolar_recorrentes()`
 * avançá-la — e ela só avança depois de `oferta_fecha_em`, NÃO depois da aula. No caso real
 * medido em 03/09:
 *
 *     eventos_live.data_hora  = 02/09 22:00 UTC   (a aula que já aconteceu)
 *     live_proxima(...)       = 09/09 22:00 UTC   (a verdade)
 *     oferta_fecha_em         = 06/09 03:00 UTC   (só aqui a coluna avança)
 *
 * São QUATRO DIAS em que a coluna aponta para o passado, e nesse intervalo:
 *
 *  1. `live-inscrever.js` mandava ao novo inscrito "sua vaga está garantida … 02 de
 *     setembro" — o primeiro e-mail que ele lê do produto, com a data de uma aula morta.
 *  2. `admin-whatsapp-fila.js` filtrava `data_hora > agora`, não achava evento nenhum e
 *     respondia "nenhuma aula futura ativa": a fila de WhatsApp ficava VAZIA exatamente nos
 *     dias em que ela é usada. Tela sem erro, lista sem gente, nada no log.
 *
 * O segundo é a forma nº 1 da lista do CLAUDE.md em estado puro — ausência entregue como
 * resposta — e o comentário em cima do filtro AFIRMAVA o contrário do que o banco faz
 * ("`data_hora` é a próxima ocorrência concreta, mesmo num evento recorrente"). Documentação
 * errada é pior que documentação nenhuma: ela fecha a investigação antes de começar.
 *
 * ⚠️ POR QUE O TESTE É DA FUNÇÃO PURA, E NÃO DO HANDLER: o que apodreceu foi a REGRA de
 * escolha da aula viva, não o encanamento HTTP. Testar o handler exigiria stub de `fetch`,
 * de `getUser` e das envs — e mediria o mock, não a regra (forma nº 10). `escolherAulaViva`
 * é exportada de `admin-whatsapp-fila.js` justamente para poder rodar em seco aqui.
 */
import { escolherAulaViva, quandoPorExtenso } from '../../api/admin-whatsapp-fila.js';
import { edicaoDe, FUSO_AULA } from '../../api/_live-edicao.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

// O ESTADO REAL DO BANCO EM 03/09, copiado da medição, não inventado.
const AGORA = Date.parse('2026-09-03T10:00:00Z');
const COLUNA_CRUA = '2026-09-02T22:00:00+00:00'; // a aula que já passou
const RECORRENCIA = '2026-09-09T22:00:00+00:00'; // o que `live_proxima` devolve
const aula = (data_hora, slug = 'leilao-ao-vivo') => ({ id: 'e6224c63', slug, titulo: 'Aula', data_hora });

console.log('\nO CASO DE PRODUÇÃO — coluna no passado, oferta ainda aberta');
const viva = escolherAulaViva([aula(RECORRENCIA)], AGORA);
checa('a aula viva é a da recorrência', viva?.data_hora === RECORRENCIA, viva?.data_hora);
checa('NÃO é a data da coluna crua', viva?.data_hora !== COLUNA_CRUA, viva?.data_hora);
// O filtro antigo (`data_hora > agora` sobre a COLUNA) é o que produzia a fila vazia.
checa('o filtro antigo teria devolvido nada', Date.parse(COLUNA_CRUA) < AGORA);

console.log('\nA JANELA DE 2h — a mesma da `live_proxima`');
// Durante a aula a fila tem de continuar valendo: é o momento em que ela mais serve.
checa('aula começada há 1h ainda é a viva',
  escolherAulaViva([aula('2026-09-03T09:00:00Z')], AGORA)?.data_hora === '2026-09-03T09:00:00Z');
checa('aula começada há 1h59 ainda é a viva',
  escolherAulaViva([aula('2026-09-03T08:01:00Z')], AGORA)?.data_hora === '2026-09-03T08:01:00Z');
// Passada a janela, some — senão a fila anunciaria uma aula encerrada como se fosse a próxima.
checa('aula de 3h atrás não é mais a viva',
  escolherAulaViva([aula('2026-09-03T07:00:00Z')], AGORA) === null);

console.log('\nVÁRIAS AULAS ATIVAS — a mais próxima ganha, e a ordem de entrada não decide');
const tres = [aula('2026-09-20T22:00:00Z', 'c'), aula(RECORRENCIA, 'a'), aula('2026-09-11T22:00:00Z', 'b')];
checa('escolhe a mais próxima', escolherAulaViva(tres, AGORA)?.slug === 'a', escolherAulaViva(tres, AGORA)?.slug);
checa('ordem invertida dá o mesmo resultado',
  escolherAulaViva([...tres].reverse(), AGORA)?.slug === 'a');
// Uma aula morta na lista não pode "ganhar" por ser a mais antiga.
checa('a morta não ganha da viva',
  escolherAulaViva([aula('2026-08-01T22:00:00Z', 'morta'), aula(RECORRENCIA, 'a')], AGORA)?.slug === 'a');

console.log('\nO VAZIO É RESPOSTA, MAS SÓ QUANDO É VAZIO DE VERDADE');
checa('lista vazia → null', escolherAulaViva([], AGORA) === null);
// `live_proxima` devolve null para evento inexistente/inativo; quem chama já filtra, mas a
// regra não pode explodir se um null passar — explodir aqui derrubaria a tela inteira.
checa('entrada nula → null', escolherAulaViva(null, AGORA) === null);
checa('linha sem data → null', escolherAulaViva([{ slug: 'x' }], AGORA) === null);
// Data ilegível NÃO pode virar "aula viva com data inválida": o texto do WhatsApp sairia
// com "Invalid Date" para todo mundo da fila.
checa('data ilegível é descartada', escolherAulaViva([aula('quarta que vem')], AGORA) === null);
checa('data ilegível não contamina a boa',
  escolherAulaViva([aula('quarta que vem', 'lixo'), aula(RECORRENCIA, 'a')], AGORA)?.slug === 'a');

console.log('\nO TEXTO DO WHATSAPP — e o que ele NÃO teria denunciado');
const comCerta = quandoPorExtenso(RECORRENCIA, AGORA);
const comCrua = quandoPorExtenso(COLUNA_CRUA, AGORA);
checa('a data certa vira "na quarta"', /quarta/.test(comCerta), comCerta);
checa('a data certa NÃO diz hoje nem amanhã', !/^(hoje|amanhã)/.test(comCerta), comCerta);
// ⚠️ ESTA ASSERÇÃO FOI ESCRITA AO CONTRÁRIO NA PRIMEIRA VERSÃO, e o teste pegou. Eu havia
// assumido que a fila de WhatsApp também anunciava a data errada, como o e-mail de inscrição.
// Não anunciava: `quandoPorExtenso` imprime dia-da-semana e hora, nunca a data — e 02/09 e
// 09/09 são as duas quartas às 19h, então o texto é BYTE A BYTE O MESMO. O dano na fila era
// só um: ela vinha vazia. Fica registrado porque a conclusão prática é oposta da intuição —
// não há nada a consertar em `quandoPorExtenso`, e o texto do WhatsApp NUNCA denunciaria uma
// mensagem enviada pela edição errada. Se um dia a aula deixar de ser sempre quarta às 19h,
// é aqui que o silêncio vai custar caro.
checa('o texto é o MESMO nas duas quartas — não era ele o defeito', comCerta === comCrua, [comCerta, comCrua]);

console.log('\nA EDIÇÃO — a chave que separa uma semana da outra');
// A unidade é a DATA LOCAL da ocorrência, porque o evento semanal reusa o mesmo `evento_id`.
checa('a edição da aula de 09/09 é 2026-09-09', edicaoDe(RECORRENCIA) === '2026-09-09', edicaoDe(RECORRENCIA));
checa('a edição da coluna crua é 2026-09-02', edicaoDe(COLUNA_CRUA) === '2026-09-02', edicaoDe(COLUNA_CRUA));
checa('as duas edições são DIFERENTES — é isso que reinclui o lead', edicaoDe(RECORRENCIA) !== edicaoDe(COLUNA_CRUA));
checa('sai no formato que o Postgres aceita em `date`', /^\d{4}-\d{2}-\d{2}$/.test(edicaoDe(RECORRENCIA)));

// ⚠️ O FUSO É O PONTO. `data_hora` é timestamptz e a aula das 19h de Salvador é 22:00Z — três
// horas antes da virada do dia em UTC. Formatar em UTC jogaria a edição para o dia SEGUINTE em
// qualquer aula depois das 21h local, e a chave de dedup do dia errado libera um segundo envio
// para a mesma pessoa. Uma aula às 21h30 local (00:30Z do dia seguinte) é o caso que prova.
checa('o fuso é o da aula, não UTC', FUSO_AULA === 'America/Bahia', FUSO_AULA);
checa('aula 21h30 local NÃO vira o dia seguinte', edicaoDe('2026-09-10T00:30:00Z') === '2026-09-09',
  edicaoDe('2026-09-10T00:30:00Z'));
checa('e em UTC viraria — o teste vale porque os dois diferem',
  new Date('2026-09-10T00:30:00Z').toISOString().slice(0, 10) === '2026-09-10');

console.log('\nO DESARME DO CONVITE — por EDIÇÃO, nunca por rodada');
// A regra de `convidar-live-cron.js`: comparar duas datas `YYYY-MM-DD` como TEXTO só é
// legítimo porque nesse formato a ordem alfabética é a cronológica. Se um dia a edição virar
// "09/09/2026", esta comparação passa a mentir em silêncio — daí a asserção.
const passou = (armado, atual) => armado < atual;
checa('edição vencida → desarma', passou('2026-09-02', '2026-09-09'));
checa('edição corrente → NÃO desarma (é o conserto: segue armado a semana toda)',
  !passou('2026-09-09', '2026-09-09'));
checa('armado para o futuro → NÃO desarma', !passou('2026-09-16', '2026-09-09'));
checa('a virada de ano não inverte a ordem', passou('2026-12-30', '2027-01-06'));

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
// Piso de asserções: um `import` que resolvesse para um módulo sem `escolherAulaViva` deixaria
// tudo "passar" com zero verificações — sucesso por ausência de medição, que é exatamente o
// defeito que este arquivo existe para pegar.
if (ok + falhas < 28) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
