/**
 * npm run testar:ig-backfill — `montarParCorpus` (api/admin-ig-backfill-comentarios.js) só
 * grava resposta que É do dono, e nunca atribui o comentário PAI à própria conta.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * O risco aqui é o mesmo dos outros arquivos de _instagram-envio: MONTAGEM errada — gravar
 * a resposta de outra pessoa como se fosse do dono (o `from.id` não bateu certo), ou gravar
 * o comentário pai com o `ig_user_id` da própria conta (criaria "conversa com nós mesmos",
 * o mesmo erro que `lerMensagem`/`lerComentario` já evitam pro webhook ao vivo).
 */
import { montarParCorpus } from '../../api/admin-ig-backfill-comentarios.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

const DONO = '28367331459563737';
const ELA = '9988776655';

console.log('\nmontarParCorpus — resposta do dono monta os dois lados certos');
{
  const comentario = { id: 'cmt1', text: 'quanto de entrada precisa?', from: { id: ELA, username: 'fulana' }, timestamp: '2026-08-01T10:00:00+0000' };
  const resposta = { id: 'rep1', text: 'de 5% a 25%, depende do leilão', from: { id: DONO }, timestamp: '2026-08-01T11:00:00+0000' };
  const par = montarParCorpus({ comentario, resposta, igUserId: DONO });

  checa('pai tem prefixo bf_c_ + id do comentário', par?.pai?.mid === 'bf_c_cmt1', par?.pai);
  checa('pai: ig_user_id é de QUEM PERGUNTOU, não do dono', par?.pai?.ig_user_id === ELA, par?.pai);
  checa('pai: direcao=recebida, autor=pessoa', par?.pai?.direcao === 'recebida' && par?.pai?.autor === 'pessoa');
  checa('pai: texto é o da pergunta original', par?.pai?.texto === 'quanto de entrada precisa?');

  checa('resposta tem prefixo bf_c_ + id da reply', par?.resposta?.mid === 'bf_c_rep1', par?.resposta);
  checa('resposta: ig_user_id é da PESSOA da conversa, não do dono', par?.resposta?.ig_user_id === ELA, par?.resposta);
  checa('resposta NUNCA é atribuída à própria conta', par?.resposta?.ig_user_id !== DONO);
  checa('resposta: direcao=enviada, autor=dono', par?.resposta?.direcao === 'enviada' && par?.resposta?.autor === 'dono');
  checa('resposta: texto é o que o dono escreveu', par?.resposta?.texto === 'de 5% a 25%, depende do leilão');
}

console.log('\nmontarParCorpus — reply de QUALQUER outra pessoa nunca vira "resposta do dono"');
{
  const comentario = { id: 'cmt2', text: 'boa pergunta', from: { id: ELA } };
  const respostaDeOutraPessoa = { id: 'rep2', text: 'concordo!', from: { id: '111222333' } };
  const par = montarParCorpus({ comentario, resposta: respostaDeOutraPessoa, igUserId: DONO });
  checa('reply de terceiro não vira par (não é a resposta que interessa)', par === null);
}

console.log('\nmontarParCorpus — dados insuficientes nunca gravam');
checa('sem id do comentário → null', montarParCorpus({ comentario: { text: 'x' }, resposta: { id: 'r', from: { id: DONO } }, igUserId: DONO }) === null);
checa('sem id da resposta → null', montarParCorpus({ comentario: { id: 'c' }, resposta: { from: { id: DONO } }, igUserId: DONO }) === null);
checa('sem igUserId configurado → null (nunca decide "é o dono" no vazio)', montarParCorpus({ comentario: { id: 'c' }, resposta: { id: 'r', from: { id: DONO } }, igUserId: undefined }) === null);
checa('comentario undefined não derruba a função', montarParCorpus({ resposta: { id: 'r', from: { id: DONO } }, igUserId: DONO }) === null);

console.log('\nmontarParCorpus — comentário pai sem texto (ex.: só sticker) grava resposta mas pai fica null');
{
  const comentario = { id: 'cmt3', from: { id: ELA } }; // sem `text`
  const resposta = { id: 'rep3', text: 'valeu!', from: { id: DONO } };
  const par = montarParCorpus({ comentario, resposta, igUserId: DONO });
  checa('resposta ainda é gravada mesmo sem o texto do pai', par?.resposta?.texto === 'valeu!');
  checa('pai vem null em vez de um texto inventado', par?.pai === null);
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 16) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
