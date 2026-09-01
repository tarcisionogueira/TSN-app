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
import { lerMensagem, lerComentario, assinaturaConfere, carimbo } from '../../api/instagram-webhook.js';

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

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 41) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara — algo não foi executado.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
