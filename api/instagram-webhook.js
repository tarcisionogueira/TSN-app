/**
 * /api/instagram-webhook — a ESCUTA do ManyChat próprio. Grava e sai. Não responde ninguém.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * GET  — devolve o `hub.challenge` da verificação do webhook no painel da Meta.
 * POST — valida `X-Hub-Signature-256`, grava mensagens em `ig_mensagens` e sai.
 *
 * ─── RESPONDER DENTRO DO WEBHOOK É ERRO, E É POR ISSO QUE ESTE ARQUIVO SÓ GRAVA ────────
 * A Meta exige 200 rápido e REENTREGA quando demora; resposta de IA leva segundos. Quem
 * responde vai ser um cron lendo a fila — a mesma separação que o motor de análise usa, e
 * pelo mesmo motivo. Na v1 não existe resposta nenhuma: o objetivo é só encher o corpus
 * enquanto a Verificação de Negócio e o App Review correm no painel (docs/INSTAGRAM_AUTOMACAO.md §2).
 *
 * ─── POR QUE EDGE, E NÃO NODE: A ASSINATURA É SOBRE O CORPO CRU ───────────────────────
 * `X-Hub-Signature-256` é HMAC-SHA256 sobre os BYTES que a Meta enviou. No runtime Node da
 * Vercel o corpo já chega parseado em `req.body`, e `JSON.stringify(req.body)` NÃO devolve
 * os mesmos bytes — ordem de chave, escape de unicode e espaço em branco mudam. O HMAC
 * fecharia às vezes e falharia às vezes, que é o pior desfecho possível numa verificação de
 * assinatura. No Edge, `req.arrayBuffer()` entrega o corpo exato. É a única razão da escolha.
 *
 * ─── A ESCUTA NÃO PASSA PELO `IG_BOT_ATIVO`, DE PROPÓSITO ─────────────────────────────
 * `IG_BOT_ATIVO` é o interruptor de RESPONDER (padrão dormente do projeto). Se ele também
 * governasse a escuta, ligar o bot um mês depois encontraria o corpus VAZIO — e o corpus é a
 * única coisa aqui que não dá para recuperar depois, porque o histórico de DM não é
 * exportável pela API. Escutar é sempre; responder é que é opcional.
 *
 * ─── ENVS (o repositório é PÚBLICO — nomes, nunca valores) ────────────────────────────
 *   IG_APP_SECRET   — valida X-Hub-Signature-256 de cada entrega.
 *   IG_VERIFY_TOKEN — responde o hub.challenge na verificação do webhook.
 * Sem as duas, o endpoint recusa tudo em vez de aceitar: webhook que aceita sem assinatura é
 * um `insert` público disfarçado.
 */

export const config = { runtime: 'edge' };

const SB  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const APP_SECRET   = process.env.IG_APP_SECRET;
const VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sb(method, path, body, prefer) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  // `.ok` ANTES do corpo. Um 401/409/5xx do PostgREST devolve JSON — lê-lo direto
  // transformaria "não gravei" em "gravei e veio vazio" (forma de falha nº 1 e nº 2).
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`PostgREST ${res.status} em ${path}: ${t.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

// ─── HMAC ────────────────────────────────────────────────────────────────────────────
// Comparação em tempo constante: `a === b` em hex vaza o prefixo comum pelo tempo de
// execução. Barato de fazer certo, caro de descobrir que estava errado.
function igual(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export async function assinaturaConfere(bytes, header, segredoTeste) {
  const segredo = segredoTeste || APP_SECRET;
  if (!segredo || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header).trim());
  if (!m) return false;
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', chave, bytes);
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return igual(hex, m[1].toLowerCase());
}

// ─── LEITURA DO EVENTO ───────────────────────────────────────────────────────────────
// Formato: { object:'instagram', entry:[{ id, time, messaging:[...], changes:[...] }] }
//
// ⚠️ QUEM É A "PESSOA" MUDA CONFORME A DIREÇÃO, e errar isto envenena o corpus inteiro.
// Numa mensagem RECEBIDA a pessoa é `sender.id`. Num ECHO (mensagem que NÓS mandamos, que a
// Meta devolve por `message_echoes`) o `sender.id` é a NOSSA conta — usar ele criaria uma
// conversa do dono com ele mesmo e jogaria todas as respostas dele numa linha só. No echo a
// pessoa é `recipient.id`.
// ⚠️ A META MISTURA SEGUNDOS E MILISSEGUNDOS NO MESMO PAYLOAD: `entry.time` e
// `value.created_time` vêm em SEGUNDOS, `messaging[].timestamp` vem em MILISSEGUNDOS.
// Errar por 1000× não dá erro nenhum — produz uma data em 1970 ou no ano 56000, e é a FILA
// que paga: um comentário carimbado em 1970 nasce com a janela de 7 dias vencida há
// décadas e some do atendimento; um carimbado no futuro nunca vence e trava a fila para
// sempre. Por isso o desempate é por GRANDEZA, e o que não for plausível vira null — que a
// fila trata caindo em `criado_em` e assumindo o pior.
const MS_2001 = 978307200000;                    // 2001-01-01: qualquer coisa antes é lixo
const MS_2100 = 4102444800000;
export function carimbo(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e11 ? n * 1000 : n;            // < 1e11 só cabe em segundos
  if (ms < MS_2001 || ms > MS_2100) return null;
  return new Date(ms).toISOString();
}

export function lerMensagem(ev) {
  const msg = ev?.message;
  if (!msg?.mid) return null;                       // read/delivery/reaction: sem mensagem
  const echo = msg.is_echo === true;
  const igUserId = echo ? ev?.recipient?.id : ev?.sender?.id;
  if (!igUserId) return null;
  return {
    mid: String(msg.mid),
    ig_user_id: String(igUserId),
    direcao: echo ? 'enviada' : 'recebida',
    // Resposta de story chega como mensagem comum com `reply_to.story`; sem isso ela seria
    // gravada como DM e o relatório de canal (spec §10) mediria outra coisa.
    origem: msg.reply_to?.story ? 'story' : 'dm',
    // Todo echo que chega aqui é do DONO por construção — ver o comment de `ig_mensagens.autor`:
    // quem enviar pelo bot grava a linha ANTES, e o echo dela bate no UNIQUE e é ignorado.
    autor: echo ? 'dono' : 'pessoa',
    texto: typeof msg.text === 'string' ? msg.text : null,
    ocorrido_em: carimbo(ev?.timestamp),   // messaging[]: MILISSEGUNDOS
  };
}

export function lerComentario(ch, entryTime) {
  const v = ch?.value;
  if (!v?.id || !v?.from?.id) return null;
  return {
    mid: `c_${v.id}`,                               // namespace: id de comentário e mid de DM
    ig_user_id: String(v.from.id),                  // são espaços diferentes na Meta
    direcao: 'recebida',
    origem: 'comentario',
    autor: 'pessoa',
    texto: typeof v.text === 'string' ? v.text : null,
    username: typeof v.from.username === 'string' ? v.from.username : null,
    // `created_time` do comentário quando vem; senão o `entry.time` da entrega. Os dois em
    // SEGUNDOS. O prazo de 7 dias conta do comentário, e uma reentrega da Meta dias depois
    // reiniciaria o relógio se isto viesse de `now()`.
    ocorrido_em: carimbo(v.created_time) || carimbo(entryTime),
  };
}

export default async function handler(req) {
  // ─── GET: verificação do webhook no painel da Meta ─────────────────────────────────
  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams;
    if (q.get('hub.mode') === 'subscribe' && VERIFY_TOKEN && q.get('hub.verify_token') === VERIFY_TOKEN) {
      return new Response(q.get('hub.challenge') || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    // Sem 'hub.mode' é alguém abrindo a URL no navegador — responde o estado, sem segredo.
    if (!q.get('hub.mode')) {
      return json({ ok: true, service: 'instagram-webhook', modo: 'so-escuta', configurado: !!(APP_SECRET && VERIFY_TOKEN && SB && SVC) });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  if (!SB || !SVC) return json({ error: 'Supabase não configurado' }, 500);
  if (!APP_SECRET) {
    // Recusa em vez de aceitar. Um webhook sem validação de assinatura é um endpoint de
    // escrita aberto — e "não consegui checar" nunca pode passar por "está tudo bem".
    console.error('[ig] IG_APP_SECRET ausente — entrega recusada');
    return json({ error: 'Webhook não configurado' }, 500);
  }

  const bytes = await req.arrayBuffer();
  if (!(await assinaturaConfere(bytes, req.headers.get('x-hub-signature-256')))) {
    console.warn('[ig] assinatura inválida ou ausente');
    return json({ error: 'Não autorizado' }, 401);
  }

  let corpo = null;
  try {
    corpo = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    // Assinatura confere mas o corpo não é JSON: é a Meta mandando algo que eu não sei ler,
    // não um forjador. Deixa rastro e devolve 200 — reentregar isto não muda nada.
    console.error('[ig] corpo assinado mas ilegível:', String(e?.message || e));
    const { error: eLog } = await sb('POST', 'ig_webhook_recebido', [{ nao_reconhecidos: 1, erro: 'corpo nao e JSON' }], 'return=minimal')
      .then(() => ({ error: null })).catch((err) => ({ error: err }));
    if (eLog) console.error('[ig] nem o log gravou:', eLog.message);
    return json({ ok: true, ignorado: 'corpo_ilegivel' });
  }

  // ─── EXTRAÇÃO ────────────────────────────────────────────────────────────────────
  const linhas = [];
  const usernames = new Map();
  const campos = new Set();
  let naoReconhecidos = 0;

  for (const entry of Array.isArray(corpo?.entry) ? corpo.entry : []) {
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      campos.add('messaging');
      const linha = lerMensagem(ev);
      // `read`, `delivery` e `reaction` chegam por aqui e não são mensagem — não são
      // "não reconhecidos", são eventos que esta versão deliberadamente não guarda.
      if (linha) linhas.push(linha);
      else if (ev?.message) naoReconhecidos++;
    }
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      campos.add(String(ch?.field || 'desconhecido'));
      if (ch?.field !== 'comments') { naoReconhecidos++; continue; }
      const linha = lerComentario(ch, entry?.time);
      if (!linha) { naoReconhecidos++; continue; }
      if (linha.username) usernames.set(linha.ig_user_id, linha.username);
      const { username, ...semUsername } = linha;
      linhas.push(semUsername);
    }
  }

  // ─── GRAVAÇÃO ────────────────────────────────────────────────────────────────────
  // A ordem é conversa → mensagem porque a leitura do corpus parte da conversa; e o
  // `resolution=ignore-duplicates` no `mid` é o que torna SEGURO devolver 500 mais abaixo:
  // a Meta reentrega o lote inteiro, e a reentrega não duplica nada.
  let gravadas = 0;
  let erro = null;
  try {
    if (linhas.length) {
      const agora = new Date().toISOString();
      const porPessoa = new Map();
      for (const l of linhas) {
        const atual = porPessoa.get(l.ig_user_id) || { ig_user_id: l.ig_user_id, username: usernames.get(l.ig_user_id) || null };
        // Só mensagem RECEBIDA move a janela de 24h. Echo nosso não reabre janela nenhuma —
        // tratar echo como contato reabriria a janela toda vez que o dono respondesse, e o
        // bot passaria a "poder" responder fora do prazo que a Meta concede.
        if (l.direcao === 'recebida') atual.ultima_msg_deles_em = agora;
        porPessoa.set(l.ig_user_id, atual);
      }
      // `merge-duplicates` mantém `primeiro_contato_em` da linha existente para as colunas que
      // não vão no payload, e atualiza as que vão.
      const conversas = await sb('POST', 'ig_conversas?on_conflict=ig_user_id',
        [...porPessoa.values()].map((c) => ({ ...c, atualizado_em: agora })),
        'return=minimal,resolution=merge-duplicates');
      void conversas;

      const gravou = await sb('POST', 'ig_mensagens?on_conflict=mid', linhas,
        'return=representation,resolution=ignore-duplicates');
      // Conta o que o BANCO devolveu, não o que eu mandei: reentrega da Meta chega com as
      // mesmas linhas e o `ignore-duplicates` descarta em silêncio. Contar `linhas.length`
      // diria "gravei 4" numa rodada que gravou zero — número plausível medindo outra coisa.
      gravadas = Array.isArray(gravou) ? gravou.length : 0;
    }
  } catch (e) {
    erro = String(e?.message || e);
    console.error('[ig] falha ao gravar:', erro);
  }

  // O log de entrega é a PROVA de que a escuta escutou. Ele grava mesmo quando a gravação
  // das mensagens falhou — é justamente aí que ele vale.
  const { error: eLog } = await sb('POST', 'ig_webhook_recebido', [{
    campos: [...campos],
    gravadas,
    nao_reconhecidos: naoReconhecidos,
    // Payload cru SÓ quando algo não foi reconhecido: guardar sempre seria estocar DM em
    // dobro, sem finalidade — e finalidade é o que a LGPD cobra.
    bruto: naoReconhecidos > 0 ? corpo : null,
    erro,
  }], 'return=minimal').then(() => ({ error: null })).catch((err) => ({ error: err }));
  if (eLog) console.error('[ig] log de entrega não gravou:', eLog.message);

  // 500 quando a gravação falhou, para a Meta REENTREGAR. Mensagem perdida aqui é corpus
  // perdido para sempre (o histórico não é exportável), e o UNIQUE em `mid` faz a reentrega
  // ser inofensiva. Devolver 200 sobre uma gravação que falhou seria carimbar sucesso sem
  // ter gravado — exatamente o que `coleta_cliente_concluir` existe para impedir do outro lado.
  if (erro) return json({ ok: false, erro }, 500);

  return json({ ok: true, gravadas, nao_reconhecidos: naoReconhecidos });
}
