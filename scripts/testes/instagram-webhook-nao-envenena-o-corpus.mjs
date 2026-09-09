/**
 * npm run testar:instagram — as armadilhas da ESCUTA do Instagram, travadas.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Este teste existe porque os defeitos possíveis aqui NÃO dão erro. Todos produzem um
 * corpus que parece cheio e está errado — e o corpus só vai ser lido semanas depois, quando
 * não houver mais como saber o que aconteceu (o histórico de DM não é exportável pela API,
 * então não dá para reconstruir).
 *
 * As três que matam, e são todas silenciosas:
 *
 *  1. ECHO ATRIBUÍDO AO REMETENTE ERRADO. No `message_echoes` o `sender.id` é a NOSSA conta.
 *     Ler `sender` nos dois casos criaria UMA conversa (a do dono com ele mesmo) contendo
 *     TODAS as respostas dele, e nenhuma pessoa teria histórico. O treino leria isso como
 *     "uma pessoa muito falante" e o painel de conversas mostraria uma linha só.
 *
 *  2. RESPOSTA DE STORY GRAVADA COMO DM. As duas viram texto no mesmo campo; a diferença só
 *     aparece em `reply_to.story`. O relatório de canal (spec §10) sairia dizendo que story
 *     não converte — medindo, na verdade, um canal que nunca foi separado. Forma nº 10.
 *
 *  3. COLISÃO ENTRE ID DE COMENTÁRIO E `mid` DE DM. São espaços de identificador DIFERENTES
 *     na Meta. Sem o prefixo, um comentário com o mesmo id de uma DM seria descartado pelo
 *     UNIQUE — e o descarte por idempotência é, por desenho, SILENCIOSO.
 *
 * Mais a assinatura, que é a única coisa aqui que separa a Meta de qualquer um com a URL.
 */
import { lerMensagem, lerComentario, assinaturaConfere, qualChaveAssina, carimbo, agruparPorPessoa } from '../../api/instagram-webhook.js';

const SEGREDO = 'segredo-de-teste-nao-e-o-de-producao';
let ok = 0, falhas = 0;

function checa(nome, condicao, detalhe = '') {
  if (condicao) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}

const NOS = '17841400563334157';   // a conta @tarcisionogueiraleiloes
const ELA = '9988776655';          // a pessoa

console.log('\n── 1. Quem é a PESSOA muda conforme a direção ──');

const recebida = lerMensagem({
  sender: { id: ELA }, recipient: { id: NOS },
  message: { mid: 'm_aaa', text: 'oi, como funciona?' },
});
checa('recebida: ig_user_id é o sender', recebida?.ig_user_id === ELA, `veio ${recebida?.ig_user_id}`);
checa('recebida: direcao=recebida, autor=pessoa', recebida?.direcao === 'recebida' && recebida?.autor === 'pessoa');

const echo = lerMensagem({
  sender: { id: NOS }, recipient: { id: ELA },
  message: { mid: 'm_bbb', text: 'funciona assim...', is_echo: true },
});
checa('echo: ig_user_id é o RECIPIENT, não a nossa conta', echo?.ig_user_id === ELA, `veio ${echo?.ig_user_id}`);
checa('echo: direcao=enviada, autor=dono', echo?.direcao === 'enviada' && echo?.autor === 'dono');
checa('echo NÃO é atribuído à nossa própria conta', echo?.ig_user_id !== NOS);

console.log('\n── 2. Story não pode ser gravado como DM ──');

const story = lerMensagem({
  sender: { id: ELA }, recipient: { id: NOS },
  message: { mid: 'm_ccc', text: '🔥', reply_to: { story: { id: 's1', url: 'https://x' } } },
});
checa('resposta de story: origem=story', story?.origem === 'story', `veio ${story?.origem}`);
checa('DM comum: origem=dm', recebida?.origem === 'dm', `veio ${recebida?.origem}`);

console.log('\n── 3. Eventos que NÃO são mensagem devolvem null (e não linha vazia) ──');

checa('read não vira mensagem', lerMensagem({ sender: { id: ELA }, read: { mid: 'm_aaa' } }) === null);
checa('delivery não vira mensagem', lerMensagem({ sender: { id: ELA }, delivery: { mids: ['m_aaa'] } }) === null);
checa('reaction não vira mensagem', lerMensagem({ sender: { id: ELA }, reaction: { mid: 'm_aaa', emoji: '❤' } }) === null);
checa('message sem mid não vira mensagem', lerMensagem({ sender: { id: ELA }, message: { text: 'x' } }) === null);
checa('message sem remetente identificável não vira mensagem', lerMensagem({ message: { mid: 'm_ddd', text: 'x' } }) === null);
// Uma mensagem só com anexo (foto/áudio) TEM mid e não tem texto. Ela conta como contato —
// move a janela de 24h — mesmo sem servir de corpus. Descartá-la faria o bot achar que a
// pessoa nunca falou.
const soAnexo = lerMensagem({ sender: { id: ELA }, recipient: { id: NOS }, message: { mid: 'm_eee', attachments: [{ type: 'image' }] } });
checa('mensagem só com anexo é gravada, com texto nulo', soAnexo !== null && soAnexo.texto === null);

console.log('\n── 4. Comentário não colide com DM ──');

const com = lerComentario({ field: 'comments', value: { id: 'm_aaa', text: 'quanto custa?', from: { id: ELA, username: 'fulana' } } });
checa('comentário recebe prefixo no mid', com?.mid === 'c_m_aaa', `veio ${com?.mid}`);
checa('comentário com MESMO id de uma DM não colide', com?.mid !== recebida?.mid);
checa('comentário: origem=comentario, autor=pessoa', com?.origem === 'comentario' && com?.autor === 'pessoa');
checa('comentário guarda o username', com?.username === 'fulana');
checa('comentário sem autor devolve null', lerComentario({ value: { id: 'x', text: 'y' } }) === null);
checa('comentário sem id devolve null', lerComentario({ value: { from: { id: ELA } } }) === null);

console.log('\n── 4a. Comentário NOSSO (resposta pública ecoada) não vira "pessoa" nem "conversa com nós mesmos" ──');

// Achado 09/09: resposta pública (`responder_publico`) cria um comentário novo, e se a Meta
// notificar esse evento pelo mesmo webhook, `from.id` é a NOSSA conta — sem esta trava, o
// próprio texto que o bot/dono acabou de mandar voltaria como pergunta nova de "pessoa",
// exatamente o corpus envenenado que este arquivo inteiro existe pra pegar.
const nosso = lerComentario({ field: 'comments', value: { id: 'r1', text: 'valeu! 🙏', from: { id: NOS, username: 'tarcisionogueiraleiloes' } } }, undefined, NOS);
checa('comentário com from.id = nossa conta devolve null (não grava errado)', nosso === null);

const deOutraPessoa = lerComentario({ field: 'comments', value: { id: 'r2', text: 'oi de novo', from: { id: ELA } } }, undefined, NOS);
checa('comentário de outra pessoa continua normal mesmo com nossaConta configurado', deOutraPessoa !== null && deOutraPessoa.autor === 'pessoa');

// Sem `nossaConta` (env não configurado), nunca decide sozinho que um comentário é "nosso" —
// evita falso-positivo silencioso que descartaria comentário de gente de verdade.
const semNossaContaConfigurada = lerComentario({ field: 'comments', value: { id: 'r3', text: 'oi', from: { id: '999999' } } });
checa('sem nossaConta configurado, comentário de qualquer id continua sendo lido normalmente', semNossaContaConfigurada !== null);

console.log('\n── 4b. Segundos × milissegundos: errar por 1000x nao da erro, quebra a FILA ──');

// A Meta manda `entry.time` em SEGUNDOS e `messaging[].timestamp` em MILISSEGUNDOS, no mesmo
// payload. Um comentario carimbado em 1970 nasce com a janela de 7 dias vencida ha decadas e
// some do atendimento; um carimbado no futuro nunca vence e entope a fila para sempre.
const SEG = Math.floor(Date.parse('2026-09-01T12:00:00Z') / 1000);
const MS  = Date.parse('2026-09-01T12:00:00Z');
checa('segundos viram a data certa', carimbo(SEG) === '2026-09-01T12:00:00.000Z', String(carimbo(SEG)));
checa('milissegundos viram a MESMA data', carimbo(MS) === '2026-09-01T12:00:00.000Z', String(carimbo(MS)));
checa('segundos e milissegundos concordam', carimbo(SEG) === carimbo(MS));
checa('string numerica tambem serve', carimbo(String(MS)) === carimbo(MS));
checa('zero e recusado', carimbo(0) === null);
checa('negativo e recusado', carimbo(-1) === null);
checa('nulo e recusado', carimbo(null) === null);
checa('texto e recusado', carimbo('ontem') === null);
checa('data anterior a 2001 e recusada (lixo, nao evento)', carimbo(100) === null);
checa('data absurda no futuro e recusada', carimbo(99999999999999) === null);

const evComData = lerMensagem({
  sender: { id: ELA }, recipient: { id: NOS }, timestamp: MS,
  message: { mid: 'm_ts', text: 'oi' },
});
checa('mensagem carrega o carimbo da Meta', evComData?.ocorrido_em === '2026-09-01T12:00:00.000Z');
const evSemData = lerMensagem({ sender: { id: ELA }, recipient: { id: NOS }, message: { mid: 'm_ts2', text: 'oi' } });
// Nulo NAO e defeito: a fila cai em `criado_em` e assume o pior. Inventar `now()` aqui seria
// dar prazo que nao existe — exatamente o erro que o carimbo veio impedir.
checa('sem carimbo devolve null (a fila assume o pior)', evSemData?.ocorrido_em === null);
const comComData = lerComentario({ field: 'comments', value: { id: 'x1', text: 'oi', from: { id: ELA }, created_time: SEG } });
checa('comentario usa created_time', comComData?.ocorrido_em === '2026-09-01T12:00:00.000Z');
const comSemData = lerComentario({ field: 'comments', value: { id: 'x2', text: 'oi', from: { id: ELA } } }, SEG);
checa('comentario sem created_time cai no entry.time', comSemData?.ocorrido_em === '2026-09-01T12:00:00.000Z');

console.log('\n── 4c. agruparPorPessoa: dois bugs P2 do bug bounty de 01/09, corrigidos em 08/09 ──');

// Bug 1: `username: null` sempre, mesmo sem valor nesta rodada — `merge-duplicates` faz
// UPDATE em toda chave presente no payload, então isso apagava, em toda DM, o username
// aprendido num COMENTÁRIO de uma rodada anterior (usernames só vêm de comentário, nunca de DM).
{
  const semUsername = new Map(); // simula um lote que é só DM — ninguém comentou nesta rodada
  const [pessoa] = agruparPorPessoa(
    [{ ig_user_id: ELA, direcao: 'recebida', ocorrido_em: null }],
    semUsername, '2026-09-08T10:00:00.000Z',
  );
  checa('sem username nesta rodada → a CHAVE nem existe no objeto (nunca null explícito)',
    !('username' in pessoa), JSON.stringify(pessoa));

  const comUsername = new Map([[ELA, 'fulana']]);
  const [pessoaComNome] = agruparPorPessoa(
    [{ ig_user_id: ELA, direcao: 'recebida', ocorrido_em: null }],
    comUsername, '2026-09-08T10:00:00.000Z',
  );
  checa('com username nesta rodada → entra normalmente', pessoaComNome.username === 'fulana', JSON.stringify(pessoaComNome));
}

// Bug 2: `ultima_msg_deles_em` usava `now()` do servidor, não o horário REAL da mensagem —
// uma reentrega da Meta de uma mensagem antiga reabriria a janela de 24h como se a pessoa
// tivesse acabado de escrever.
{
  const agora = '2026-09-08T10:00:00.000Z';
  const antiga = '2026-01-01T00:00:00.000Z'; // simula reentrega tardia de mensagem velha
  const [pessoa] = agruparPorPessoa(
    [{ ig_user_id: ELA, direcao: 'recebida', ocorrido_em: antiga }],
    new Map(), agora,
  );
  checa('usa o horário REAL da mensagem, não now() do servidor',
    pessoa.ultima_msg_deles_em === antiga, pessoa.ultima_msg_deles_em);

  const [semCarimbo] = agruparPorPessoa(
    [{ ig_user_id: ELA, direcao: 'recebida', ocorrido_em: null }],
    new Map(), agora,
  );
  checa('sem carimbo plausível → cai pra agora (nunca pior que o comportamento antigo)',
    semCarimbo.ultima_msg_deles_em === agora, semCarimbo.ultima_msg_deles_em);

  const recente = '2026-09-08T09:00:00.000Z';
  const [duasMensagens] = agruparPorPessoa(
    [
      { ig_user_id: ELA, direcao: 'recebida', ocorrido_em: antiga },
      { ig_user_id: ELA, direcao: 'recebida', ocorrido_em: recente },
    ],
    new Map(), agora,
  );
  checa('duas mensagens recebidas no lote → fica com a MAIS RECENTE das reais',
    duasMensagens.ultima_msg_deles_em === recente, duasMensagens.ultima_msg_deles_em);

  const [comEcho] = agruparPorPessoa(
    [
      { ig_user_id: ELA, direcao: 'recebida', ocorrido_em: antiga },
      { ig_user_id: ELA, direcao: 'enviada', ocorrido_em: recente }, // echo do dono
    ],
    new Map(), agora,
  );
  checa('echo (enviada) NUNCA move a janela — só "recebida" conta',
    comEcho.ultima_msg_deles_em === antiga, comEcho.ultima_msg_deles_em);
}

checa('atualizado_em sempre presente, é o mesmo `agora` passado', (() => {
  const [p] = agruparPorPessoa([{ ig_user_id: ELA, direcao: 'enviada', ocorrido_em: null }], new Map(), '2026-09-08T10:00:00.000Z');
  return p.atualizado_em === '2026-09-08T10:00:00.000Z';
})());

console.log('\n── 5. Assinatura: só a Meta entra ──');

const corpo = new TextEncoder().encode(JSON.stringify({ object: 'instagram', entry: [{ id: NOS }] }));

async function assinar(bytes) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, bytes);
  return Array.from(new Uint8Array(s)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hex = await assinar(corpo);
checa('assinatura correta passa', await assinaturaConfere(corpo, `sha256=${hex}`, SEGREDO));
checa('assinatura em MAIÚSCULA passa (hex é case-insensitive)', await assinaturaConfere(corpo, `sha256=${hex.toUpperCase()}`, SEGREDO));

// Um byte alterado no corpo: é o caso que importa. Uma verificação que aceitasse isto seria
// pior do que nenhuma, porque daria a impressão de existir.
const adulterado = new TextEncoder().encode(JSON.stringify({ object: 'instagram', entry: [{ id: '1' }] }));
checa('corpo adulterado é recusado', !(await assinaturaConfere(adulterado, `sha256=${hex}`, SEGREDO)));
checa('segredo errado é recusado', !(await assinaturaConfere(corpo, `sha256=${hex}`, 'outro-segredo')));
checa('header sem o prefixo sha256= é recusado', !(await assinaturaConfere(corpo, hex, SEGREDO)));
checa('header ausente é recusado', !(await assinaturaConfere(corpo, null, SEGREDO)));
checa('header vazio é recusado', !(await assinaturaConfere(corpo, '', SEGREDO)));
checa('sha1 (formato antigo) é recusado', !(await assinaturaConfere(corpo, `sha1=${hex.slice(0, 40)}`, SEGREDO)));
// Sem segredo configurado a resposta é RECUSAR, nunca aceitar: "não consigo checar" não
// pode passar por "está tudo bem" — é a regra do verificador de schema, aplicada aqui.
checa('sem segredo configurado, recusa (não aceita)', !(await assinaturaConfere(corpo, `sha256=${hex}`, undefined)));

console.log('\n── 6. Qual chave assinou: NOME, não booleano ──');
// A Meta expõe DOIS segredos para o mesmo app (o do app e o "do app do Instagram", com id
// próprio) e a doc não diz qual assina o webhook no caminho do Instagram Login. Chutar sairia
// caro do jeito mais silencioso possível: o GET de verificação passa só com o verify token, e
// o que quebraria é o POST — 401 em toda entrega, zero linhas no banco, sintoma idêntico ao de
// "ninguém mandou mensagem". Por isso o webhook aceita qualquer uma das duas e REGISTRA qual
// fechou; quando a produção responder, a perdedora sai.
checa('devolve o NOME da chave que fecha', (await qualChaveAssina(corpo, `sha256=${hex}`, SEGREDO)) === 'teste');
checa('chave errada devolve null, não string vazia', (await qualChaveAssina(corpo, `sha256=${hex}`, 'outro')) === null);
checa('sem header devolve null', (await qualChaveAssina(corpo, null, SEGREDO)) === null);
checa('corpo adulterado devolve null', (await qualChaveAssina(adulterado, `sha256=${hex}`, SEGREDO)) === null);
// O booleano antigo continua valendo — é o contrato que o handler e o resto do teste usam.
checa('o booleano concorda com o nome', (await assinaturaConfere(corpo, `sha256=${hex}`, SEGREDO))
  === ((await qualChaveAssina(corpo, `sha256=${hex}`, SEGREDO)) !== null));

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 57) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara — algo não foi executado.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
