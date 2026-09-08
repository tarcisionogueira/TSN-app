/**
 * npm run testar:ig-envio — o envio real do Instagram (api/_instagram-envio.js) monta o
 * `recipient` certo pra cada canal, e nunca chama a Send API sem os dois segredos.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * O risco aqui não é a chamada de rede (isso só se prova contra a Meta de verdade) — é a
 * MONTAGEM do corpo: mandar DM pro id errado, esquecer de tirar o prefixo `c_` do id de
 * comentário (que é só o nosso namespace interno, a Meta não conhece), ou deixar passar um
 * texto vazio pra Send API cobrar da conta por nada.
 */
import { montarCorpoEnvio, envioConfigurado } from '../../api/_instagram-envio.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nmontarCorpoEnvio — DM usa recipient.id, nunca comment_id');
{
  const c = montarCorpoEnvio({ tipo: 'dm', igUserId: '123456' }, 'oi, tudo bem?');
  checa('recipient.id é o ig_user_id real', c?.recipient?.id === '123456', c);
  checa('nunca inclui comment_id numa DM', !('comment_id' in (c?.recipient || {})), c);
  checa('texto vai literal, sem reescrever', c?.message?.text === 'oi, tudo bem?', c);
}
checa('DM sem ig_user_id → null (não manda pro vazio)', montarCorpoEnvio({ tipo: 'dm', igUserId: '' }, 'oi') === null);
checa('DM sem texto → null (não gasta a API com nada)', montarCorpoEnvio({ tipo: 'dm', igUserId: '123' }, '') === null);
checa('DM com texto só de espaços → null', montarCorpoEnvio({ tipo: 'dm', igUserId: '123' }, '   ') === null);

console.log('\nmontarCorpoEnvio — comentário usa recipient.comment_id, SEMPRE sem o prefixo c_');
{
  const comPrefixo = montarCorpoEnvio({ tipo: 'comentario', commentId: 'c_17869900112233' }, 'valeu pelo comentário!');
  checa('tira o prefixo c_ (a Meta não conhece esse namespace)', comPrefixo?.recipient?.comment_id === '17869900112233', comPrefixo);

  const semPrefixo = montarCorpoEnvio({ tipo: 'comentario', commentId: '17869900112233' }, 'valeu!');
  checa('funciona também sem o prefixo (idempotente)', semPrefixo?.recipient?.comment_id === '17869900112233', semPrefixo);

  checa('nunca inclui id de DM num comentário', !('id' in (comPrefixo?.recipient || {})), comPrefixo);
}
checa('comentário sem commentId → null', montarCorpoEnvio({ tipo: 'comentario', commentId: '' }, 'oi') === null);
checa('comentário só com o prefixo e nada depois → null (id vazio depois de tirar o c_)',
  montarCorpoEnvio({ tipo: 'comentario', commentId: 'c_' }, 'oi') === null);

console.log('\nmontarCorpoEnvio — tipo desconhecido nunca vira envio às cegas');
checa('tipo inexistente → null', montarCorpoEnvio({ tipo: 'story-reaction', igUserId: '123' }, 'oi') === null);
checa('sem destino nenhum → null', montarCorpoEnvio(null, 'oi') === null);

console.log('\nenvioConfigurado — só true com os DOIS segredos presentes');
{
  const igAntes = process.env.IG_USER_ID;
  const tokenAntes = process.env.IG_PAGE_TOKEN;
  try {
    delete process.env.IG_USER_ID;
    delete process.env.IG_PAGE_TOKEN;
    checa('sem nenhum dos dois → não configurado', envioConfigurado() === false);

    process.env.IG_USER_ID = '17841400563334157';
    delete process.env.IG_PAGE_TOKEN;
    checa('só com IG_USER_ID (sem token) → não configurado', envioConfigurado() === false);

    delete process.env.IG_USER_ID;
    process.env.IG_PAGE_TOKEN = 'token-de-teste';
    checa('só com IG_PAGE_TOKEN (sem user id) → não configurado', envioConfigurado() === false);

    process.env.IG_USER_ID = '17841400563334157';
    process.env.IG_PAGE_TOKEN = 'token-de-teste';
    checa('com os dois → configurado', envioConfigurado() === true);
  } finally {
    // restaura o ambiente real, pra não vazar estado de teste pro resto do processo
    if (igAntes === undefined) delete process.env.IG_USER_ID; else process.env.IG_USER_ID = igAntes;
    if (tokenAntes === undefined) delete process.env.IG_PAGE_TOKEN; else process.env.IG_PAGE_TOKEN = tokenAntes;
  }
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 15) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
