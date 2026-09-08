/**
 * api/_instagram-envio.js — Send API do Instagram. Envio de VERDADE, pela primeira vez neste
 * projeto (08/09) — até aqui, `admin-ig-caixa.js` só registrava "copiei e colei no app".
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Só é chamado por um clique EXPLÍCITO do admin em `/admin/instagram` (ação 'enviar' de
 * `admin-ig-caixa.js`) — nunca autônomo. `IG_BOT_ATIVO` continua sendo o interruptor de
 * resposta AUTOMÁTICA (que não existe ainda); isto aqui é só a peça que faltava pra até o
 * envio MANUAL deixar de precisar de copiar-colar no app.
 *
 * ─── DM E COMENTÁRIO USAM O MESMO ENDPOINT, SÓ MUDA O `recipient` ─────────────────────
 * DM (e resposta/reação de story, que chega pelo mesmo `messages` do webhook): `recipient.id`.
 * Comentário: PRIVATE REPLY via `recipient.comment_id` — é a forma sancionada de mandar a
 * primeira mensagem pra quem não escreveu por DM (tiro único por comentário, 7 dias — ver
 * docs/INSTAGRAM_AUTOMACAO.md §7). Nunca posta resposta PÚBLICA visível sob o comentário —
 * essa é outra permissão, outro endpoint, fora do escopo desta v1.
 *
 * ⚠️ SEM CONFIRMAÇÃO CONTRA TRÁFEGO REAL AINDA (sessão sem token válido/tráfego aprovado no
 * momento em que isto foi escrito — ver Parte 14 do HANDOFF). `GRAPH_VERSION` e o formato
 * exato do corpo merecem conferência contra a documentação viva da Meta antes do 1º envio de
 * verdade — a mesma régua que `docs/INSTAGRAM_AUTOMACAO.md` §8 já pede pro resto do projeto.
 */
const GRAPH_VERSION = 'v21.0';

function envCfg() {
  return { igUserId: process.env.IG_USER_ID, pageToken: process.env.IG_PAGE_TOKEN };
}

export function envioConfigurado() {
  const { igUserId, pageToken } = envCfg();
  return !!(igUserId && pageToken);
}

/**
 * Monta o corpo da chamada — pura, sem rede, testável em isolamento (é aqui que mora o risco
 * real: esquecer de tirar o prefixo `c_` do mid, ou mandar `recipient` vazio pra Meta).
 * `destino.tipo` é `'dm'` (usa `igUserId`) ou `'comentario'` (usa `commentId`, com ou sem o
 * prefixo `c_` que `ig_mensagens.mid` usa — ver `lerComentario` em instagram-webhook.js; a
 * Meta não conhece esse prefixo, é só o nosso namespace interno).
 */
export function montarCorpoEnvio(destino, texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  if (destino?.tipo === 'dm') {
    const id = String(destino.igUserId || '').trim();
    return id ? { recipient: { id }, message: { text: t } } : null;
  }
  if (destino?.tipo === 'comentario') {
    const bruto = String(destino.commentId || '').replace(/^c_/, '').trim();
    return bruto ? { recipient: { comment_id: bruto }, message: { text: t } } : null;
  }
  return null;
}

async function chamarSendAPI(corpo) {
  if (!envioConfigurado()) return { ok: false, erro: 'nao_configurado', detalhe: 'IG_USER_ID/IG_PAGE_TOKEN ausentes' };
  const { igUserId, pageToken } = envCfg();
  let r;
  try {
    r = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pageToken}` },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    return { ok: false, erro: 'falha_rede', detalhe: String(e?.message || e) };
  }
  const j = await r.json().catch(() => null);
  // `.ok` ANTES do corpo: a Graph API devolve JSON de erro também em 4xx/5xx — lê-lo direto
  // transformaria "a Meta recusou" em "enviei e voltou vazio", a mesma forma de falha nº 1 do
  // topo do HANDOFF, agora do lado de FORA da nossa infra.
  if (!r.ok) {
    return { ok: false, erro: 'recusado_pela_meta', status: r.status, detalhe: j?.error?.message || JSON.stringify(j || {}).slice(0, 300) };
  }
  // 200 sem `message_id` não é sucesso confirmado — é a mesma classe de "carimbou sem provar"
  // que `coleta_cliente_concluir` existe pra impedir do outro lado do sistema.
  if (!j?.message_id) return { ok: false, erro: 'sem_confirmacao', detalhe: JSON.stringify(j || {}).slice(0, 300) };
  return { ok: true, message_id: j.message_id };
}

export function enviarDM(igUserId, texto) {
  const corpo = montarCorpoEnvio({ tipo: 'dm', igUserId }, texto);
  return corpo ? chamarSendAPI(corpo) : Promise.resolve({ ok: false, erro: 'dados_insuficientes' });
}

export function enviarPrivateReply(commentId, texto) {
  const corpo = montarCorpoEnvio({ tipo: 'comentario', commentId }, texto);
  return corpo ? chamarSendAPI(corpo) : Promise.resolve({ ok: false, erro: 'dados_insuficientes' });
}
