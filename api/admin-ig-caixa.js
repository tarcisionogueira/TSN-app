/**
 * GET  /api/admin-ig-caixa  → os rascunhos pendentes, em ordem de VENCIMENTO, com contexto
 * POST /api/admin-ig-caixa  → o desfecho de um rascunho, ou o estado de uma conversa
 *
 * ⚠️ ESTA TELA NÃO ENVIA NADA PELO INSTAGRAM, e isso está escrito nela. Enquanto
 * `_ig-envio.js` não existe (e enquanto a Meta não liberar a permissão), quem responde é o
 * dono, no app, com o texto copiado daqui. "Marcar como enviado" é REGISTRO, não envio —
 * exatamente como a fila de WhatsApp, e pelo mesmo motivo: uma tela que dissesse "enviando"
 * e só copiasse texto seria a mentira mais cara possível.
 *
 * ─── POR QUE O REGISTRO IMPORTA MAIS DO QUE PARECE ───────────────────────────────────
 * A régua de promoção é "a classe vira autônoma quando o dono envia o rascunho SEM EDITAR em
 * 8 de 10 casos". Ela compara `texto_sugerido` com `texto_enviado`. Se o botão gravasse o
 * texto ORIGINAL em vez do que está na caixa de edição no momento do clique, os dois campos
 * seriam sempre idênticos, a taxa daria 100% desde o primeiro caso, e a régua liberaria
 * classes para responder sozinhas com base numa medição que só mediu a si mesma. Por isso o
 * POST exige o `texto` do cliente e é ELE que vai para `texto_enviado`.
 *
 * ─── A LIÇÃO DA FILA DE WHATSAPP, APLICADA ───────────────────────────────────────────
 * `whatsapp_disparo_log` ficou com ZERO linhas por um tempo porque marcar exigia um clique a
 * mais depois do trabalho já feito — e ninguém volta para marcar. Aqui o mesmo clique que
 * copia o texto é o que registra. Atrito extra não é rigor: é o que garante dado nenhum.
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TETO_PENDENTES = 60;   // o que cabe numa sessão de leitura; o resto volta na próxima

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json', ...(init.headers || {}),
  },
});

/** PostgREST `in.()` com texto: aspas duplas, e o que tiver aspas dentro não entra na lista. */
const listaIn = (vals) => vals
  .map((v) => String(v))
  .filter((v) => v && !v.includes('"'))
  .map((v) => `"${v}"`)
  .join(',');

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  // `.ok` ANTES do corpo: um 5xx do PostgREST devolve objeto de erro e `[perfil]` viria
  // `undefined` — falha de leitura tratada como "não é admin". Negar por falha e negar por
  // identidade não são a mesma coisa, e só uma delas significa que alguém precisa olhar o log.
  const rPerfil = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!rPerfil.ok) return res.status(502).json({ error: 'perfil_ilegivel', detalhe: await rPerfil.text() });
  const [perfil] = await rPerfil.json();
  if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });

  if (req.method === 'POST') return desfecho(req, res, user);
  return caixa(res);
}

// ─────────────────────────────────────────────────────────────────────────────────────
// GET — a caixa
// ─────────────────────────────────────────────────────────────────────────────────────
async function caixa(res) {
  const rRasc = await sb(
    'ig_rascunho?select=id,mid_origem,ig_user_id,origem,janela,vence_em,classe,classe_conf,'
    + 'texto_sugerido,acao,motivo,modelo,criado_em'
    + '&enviado_em=is.null&descartado_em=is.null'
    // A ordem é a da FILA — vencimento primeiro. Ordenar por chegada aqui desfaria a única
    // coisa que a fila do banco faz: um comentário a 6 dias de perder a private reply
    // (que é tiro único e PARA SEMPRE) tem de vir antes de uma DM de dez minutos.
    + `&order=vence_em.asc.nullslast,criado_em.asc&limit=${TETO_PENDENTES}`,
  );
  // Erro de leitura NUNCA vira caixa vazia: "não há o que responder" e "não consegui ler"
  // se parecem na tela e levam a decisões opostas — a primeira é descanso, a segunda é
  // janela queimando enquanto ninguém sabe.
  if (!rRasc.ok) return res.status(502).json({ error: 'rascunhos_ilegiveis', detalhe: await rRasc.text() });
  const rascunhos = await rRasc.json();

  let mensagens = {};
  let conversas = {};
  if (rascunhos.length) {
    // ⚠️ SEM `.limit` NESTAS DUAS, de propósito. Elas vão ser CRUZADAS por chave com a lista
    // acima, e janela de cache não é janela de dados (forma de falha nº 9): um corte próprio
    // aqui faria alguns rascunhos aparecerem sem o texto da pergunta que os originou — com
    // cara de "a pessoa não escreveu nada", que é o oposto do que estaria acontecendo.
    const mids = listaIn(rascunhos.map((r) => r.mid_origem));
    const users = listaIn([...new Set(rascunhos.map((r) => r.ig_user_id))]);
    const [rMsg, rConv] = await Promise.all([
      mids ? sb(`ig_mensagens?select=mid,texto,origem,criado_em,ocorrido_em&mid=in.(${mids})`) : null,
      users ? sb(`ig_conversas?select=ig_user_id,username,estado,resumo,ultima_msg_deles_em&ig_user_id=in.(${users})`) : null,
    ]);
    if (rMsg && !rMsg.ok) return res.status(502).json({ error: 'mensagens_ilegiveis', detalhe: await rMsg.text() });
    if (rConv && !rConv.ok) return res.status(502).json({ error: 'conversas_ilegiveis', detalhe: await rConv.text() });
    mensagens = Object.fromEntries(((rMsg && await rMsg.json()) || []).map((m) => [m.mid, m]));
    conversas = Object.fromEntries(((rConv && await rConv.json()) || []).map((c) => [c.ig_user_id, c]));
  }

  const agora = Date.now();
  const itens = rascunhos.map((r) => {
    const msg = mensagens[r.mid_origem] || null;
    const conv = conversas[r.ig_user_id] || null;
    const venc = r.vence_em ? Date.parse(r.vence_em) : null;
    return {
      ...r,
      pergunta: msg?.texto ?? null,
      // `null` e `''` são coisas diferentes e a tela precisa distinguir: mensagem só com
      // foto/áudio TEM linha e não tem texto — não é mensagem que sumiu.
      pergunta_ausente: !msg,
      username: conv?.username || null,
      estado: conv?.estado || null,
      resumo: conv?.resumo || null,
      horas_restantes: venc == null ? null : Math.round(((venc - agora) / 3600000) * 10) / 10,
      expirado: venc == null ? null : venc <= agora,
    };
  });

  // Régua e resumo são informativos: se falharem, a caixa continua de pé. Mas o campo volta
  // `null`, e nunca `[]` — uma lista vazia diria "nenhuma classe tem histórico", que é uma
  // afirmação, e o que houve foi ausência de leitura.
  const [rResumo, rRegua] = await Promise.all([
    sb('rpc/ig_caixa_resumo', { method: 'POST', body: '{}' }),
    sb('rpc/ig_taxa_sem_edicao', { method: 'POST', body: '{}' }),
  ]);
  const opcional = async (r, rotulo) => {
    if (!r.ok) { console.error(`[ig-caixa] ${rotulo} ilegível:`, await r.text()); return null; }
    return r.json().catch(() => null);
  };

  return res.status(200).json({
    itens,
    truncado: rascunhos.length >= TETO_PENDENTES,
    resumo: await opcional(rResumo, 'resumo'),
    regua: await opcional(rRegua, 'régua'),
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────
// POST — o desfecho
// ─────────────────────────────────────────────────────────────────────────────────────
const ESTADOS = ['bot', 'humano', 'pausado'];

async function desfecho(req, res, user) {
  const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const acao = String(corpo.acao || '');

  if (acao === 'estado') {
    const igUserId = String(corpo.ig_user_id || '');
    const estado = String(corpo.estado || '');
    if (!/^[0-9]{1,32}$/.test(igUserId)) return res.status(400).json({ error: 'ig_user_id invalido' });
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'estado invalido' });
    const r = await sb(`ig_conversas?ig_user_id=eq.${igUserId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ estado, atualizado_em: new Date().toISOString() }),
    });
    if (!r.ok) return res.status(502).json({ error: 'nao_mudou_estado', detalhe: await r.text() });
    // UPDATE que não alcança linha nenhuma devolve 200 com lista vazia (forma de falha nº 3).
    // Sem esta checagem a tela mostraria "assumi a conversa" sobre uma gravação que não houve,
    // e o cron continuaria rascunhando como se ninguém tivesse assumido.
    const linhas = await r.json().catch(() => []);
    if (!Array.isArray(linhas) || !linhas.length) return res.status(404).json({ error: 'conversa_nao_encontrada' });
    return res.status(200).json({ ok: true, estado });
  }

  const id = Number(corpo.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalido' });

  const patch = { };
  if (acao === 'enviado') {
    const texto = String(corpo.texto ?? '').trim();
    // Sem texto não há o que medir, e gravar `texto_enviado` vazio faria a régua comparar a
    // sugestão com o nada — 0% de igualdade, "a persona não presta", medindo o formulário.
    if (!texto) return res.status(400).json({ error: 'texto vazio' });
    // É o texto QUE VEIO DA TELA, não o sugerido. Ver o cabeçalho: é essa diferença que a
    // régua de promoção lê, e copiar o sugerido aqui a tornaria 100% por construção.
    patch.enviado_em = new Date().toISOString();
    patch.texto_enviado = texto;
  } else if (acao === 'descartar') {
    patch.descartado_em = new Date().toISOString();
    patch.descartado_motivo = String(corpo.motivo || '').trim().slice(0, 300) || null;
  } else {
    return res.status(400).json({ error: 'acao desconhecida' });
  }

  // O filtro repete `enviado_em is null and descartado_em is null`: se outra aba já deu um
  // desfecho a este rascunho, este PATCH não alcança nada e o 409 abaixo conta a verdade,
  // em vez de sobrescrever em silêncio o que já estava decidido.
  const r = await sb(`ig_rascunho?id=eq.${id}&enviado_em=is.null&descartado_em=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return res.status(502).json({ error: 'nao_gravou', detalhe: await r.text() });
  const [linha] = await r.json().catch(() => []);
  if (!linha) return res.status(409).json({ error: 'ja_teve_desfecho' });

  // A mensagem sai da FILA nos dois casos. Descartar também resolve: sem isto, o mesmo item
  // voltaria amanhã, o cron gastaria IA de novo (o claim é por `mid_origem`, e o rascunho
  // antigo já existe — então nem gastaria, mas `ig_janela_a_queimar()` seguiria alarmando
  // sobre um prazo que o dono já decidiu não usar).
  const rMsg = await sb(`ig_mensagens?mid=eq.${encodeURIComponent(linha.mid_origem)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ respondida: true }),
  });
  let filaLimpa = true;
  if (!rMsg.ok) {
    console.error('[ig-caixa] desfecho gravado mas a mensagem segue na fila:', await rMsg.text());
    filaLimpa = false;
  } else {
    const alcancadas = await rMsg.json().catch(() => []);
    filaLimpa = Array.isArray(alcancadas) && alcancadas.length > 0;
  }

  console.log('[ig-caixa]', acao, 'rascunho', id, 'por', user.id, 'fila_limpa=', filaLimpa);
  // `fila_limpa` volta para a tela: o desfecho VALEU (é o que a régua lê), mas se a mensagem
  // não saiu da fila o dono verá o item de novo amanhã, e precisa saber por quê — senão vira
  // "esta tela repete rascunho" e ele para de usar.
  return res.status(200).json({ ok: true, acao, fila_limpa: filaLimpa });
}
