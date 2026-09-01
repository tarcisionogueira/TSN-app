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
import { lerMensagem, lerComentario, assinaturaConfere } from '../../api/instagram-webhook.js';

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
if (ok + falhas < 25) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara — algo não foi executado.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
