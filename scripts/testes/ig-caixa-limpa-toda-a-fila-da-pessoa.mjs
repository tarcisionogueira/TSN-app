/**
 * npm run testar:ig-caixa — o desfecho de um rascunho do Instagram dá baixa em TODA mensagem
 * não respondida da pessoa no mesmo canal, não só no `mid_origem` daquele rascunho.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Achado 08/09 (P2 do bug bounty de 01/09, nunca corrigido até hoje): a fila
 * (`ig_fila_resposta`) colapsa várias DMs seguidas da mesma pessoa numa linha só — "uma
 * janela, uma resposta". Mas o desfecho antigo só marcava `respondida=true` no `mid` daquele
 * rascunho específico. As mensagens anteriores da mesma pessoa continuavam com
 * `respondida=false`, voltavam à fila sozinhas e geravam rascunho duplicado — e a régua de
 * promoção (`ig_taxa_sem_edicao`) contaria a MESMA resposta do dono como se fossem duas.
 *
 * Este teste não bate no banco — trava só a QUERY que `filtroLimparFila` monta, porque é ela
 * que carrega a correção inteira (o resto do handler já era genérico).
 */
import { filtroLimparFila } from '../../api/admin-ig-caixa.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${extra}` : ''}`); }
};

console.log('\nfiltroLimparFila — filtra por PESSOA, CANAL, só recebida e só não respondida');
{
  const q = filtroLimparFila({ ig_user_id: '123', origem: 'dm' });
  checa('filtra pela pessoa (ig_user_id)', q.includes('ig_user_id=eq.123'), q);
  checa('filtra pelo canal (origem) — comentário não pode dar baixa em DM e vice-versa', q.includes('origem=eq.dm'), q);
  checa('só mensagem RECEBIDA — nunca marca o que O DONO mandou como "respondida"', q.includes('direcao=eq.recebida'), q);
  checa('só quem ainda não tinha sido respondida — nunca reabre o que já estava fechado', q.includes('respondida=eq.false'), q);
}

console.log('\nfiltroLimparFila — canais diferentes geram queries diferentes (não vazam um pro outro)');
{
  const qDm = filtroLimparFila({ ig_user_id: '999', origem: 'dm' });
  const qComentario = filtroLimparFila({ ig_user_id: '999', origem: 'comentario' });
  checa('DM e comentário da MESMA pessoa geram queries diferentes', qDm !== qComentario, `${qDm} vs ${qComentario}`);
  checa('a query de DM não menciona comentário', !qDm.includes('comentario'), qDm);
}

console.log('\nfiltroLimparFila — ig_user_id e origem vão url-encoded (defesa contra valor com caractere especial)');
{
  const q = filtroLimparFila({ ig_user_id: '1&2', origem: 'dm' });
  checa('"&" no id não quebra o filtro em dois parâmetros novos', !q.includes('ig_user_id=eq.1&2'), q);
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 7) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
