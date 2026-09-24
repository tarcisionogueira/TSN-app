/**
 * /api/whatsapp-webhook — ESCUTA do WhatsApp oficial (Cloud API da Meta). Grava e sai.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * GET  — devolve o `hub.challenge` da verificação do webhook no painel da Meta; sem `hub.mode`
 *        responde o ESTADO da configuração (nomes das envs que faltam, nunca valores).
 * POST — valida `X-Hub-Signature-256` sobre o corpo CRU, grava em `wa_conversas`/`wa_mensagens`
 *        e acorda o respondedor (`api/whatsapp-responder.js`) sem esperar por ele.
 *
 * Mesmo desenho do `instagram-webhook.js`, pelos mesmos motivos (ler o cabeçalho de lá):
 *  - EDGE, porque o HMAC é sobre os BYTES que a Meta mandou — no Node o corpo chega parseado
 *    e `JSON.stringify` não devolve os mesmos bytes;
 *  - SÓ GRAVA: a Meta exige 200 rápido e REENTREGA quando demora; IA leva segundos. O
 *    respondedor é acordado via `waitUntil` (latência de segundos) e há um cron de 5 min como
 *    rede de segurança — mensagem nunca fica sem resposta porque um disparo se perdeu;
 *  - ESCUTAR É SEMPRE; RESPONDER depende de `WA_BOT_ATIVO=1` (lá no respondedor).
 *
 * TRÊS TIPOS DE EVENTO chegam no campo `messages`/`smb_message_echoes`:
 *  - `messages[]`   — a PESSOA escreveu → linha 'recebida', `resposta_status='pendente'`;
 *  - `statuses[]`   — sent/delivered/read/failed de uma mensagem NOSSA → atualiza a entrega;
 *  - `message_echoes[]` (coexistência: o número também está no app WhatsApp Business) — a
 *    EQUIPE respondeu pelo celular → grava como 'equipe' e PAUSA a IA naquela conversa por
 *    12 h. Sem isso a IA atropelaria o humano que acabou de assumir.
 *
 * ENVS (o repositório é PÚBLICO — nomes, nunca valores):
 *   WA_VERIFY_TOKEN — hub.challenge da verificação.
 *   WA_APP_SECRET   — assina as entregas (Chave secreta do app, Configurações → Básico).
 *                     Se o app da Meta for o MESMO do Instagram, `IG_APP_SECRET` também vale.
 * Sem segredo, recusa tudo: webhook que aceita sem assinatura é um `insert` público.
 */
export const config = { runtime: 'edge' };

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
const SEGREDOS = [
  ['WA_APP_SECRET', process.env.WA_APP_SECRET],
  ['IG_APP_SECRET', process.env.IG_APP_SECRET],
].filter(([, v]) => !!v);
const PAUSA_HUMANO_MS = 12 * 3600 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sb(method, path, body, prefer) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PostgREST ${res.status} em ${path.split('?')[0]}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

// ─── HMAC (tempo constante) ──────────────────────────────────────────────────────────
function igual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function assinaturaWaConfere(bytes, header, segredos = SEGREDOS.map(([, v]) => v)) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || '').trim());
  if (!m) return false;
  for (const segredo of segredos) {
    const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', chave, bytes));
    const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (igual(hex, m[1].toLowerCase())) return true;
  }
  return false;
}

// `timestamp` do WhatsApp vem em SEGUNDOS (string). Implausível → null (a fila usa criado_em).
export function carimboWa(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e11 ? n * 1000 : n;
  if (ms < 978307200000 || ms > 4102444800000) return null;
  return new Date(ms).toISOString();
}

// Texto legível de qualquer tipo de mensagem. Mídia/localização/etc. viram um marcador — a IA
// precisa saber que a pessoa mandou ALGO (e pedir em texto), não receber um vazio.
export function textoDaMensagem(m) {
  if (!m) return null;
  if (m.type === 'text') return m.text?.body ?? null;
  if (m.type === 'button') return m.button?.text ?? null;
  if (m.type === 'interactive') return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || null;
  if (['image', 'video', 'document', 'audio', 'sticker'].includes(m.type)) {
    const leg = m[m.type]?.caption;
    return `[${m.type === 'audio' ? 'áudio' : m.type === 'image' ? 'imagem' : m.type === 'document' ? 'documento' : m.type}${leg ? `: ${leg}` : ''}]`;
  }
  if (m.type === 'location') return '[localização]';
  if (m.type === 'reaction') return null;            // reação não é mensagem a responder
  return `[${m.type || 'mensagem'}]`;
}

/** Extrai tudo de um corpo de webhook. Função pura (testável sem rede). */
export function lerEntregaWa(corpo) {
  const conversas = new Map();   // telefone → { telefone, nome?, ultima_msg_deles_em?, ia_pausada_ate? }
  const mensagens = [];
  const statuses = [];
  for (const entry of Array.isArray(corpo?.entry) ? corpo.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value || {};
      const nomes = new Map((v.contacts || []).map((c) => [String(c.wa_id), c.profile?.name || null]));
      for (const m of v.messages || []) {
        const tel = String(m.from || '').replace(/\D/g, '');
        const texto = textoDaMensagem(m);
        if (!tel || !m.id || texto == null) continue;
        const quando = carimboWa(m.timestamp);
        const c = conversas.get(tel) || { telefone: tel };
        if (nomes.get(tel)) c.nome = nomes.get(tel);
        if (!c.ultima_msg_deles_em || (quando || '') > c.ultima_msg_deles_em) c.ultima_msg_deles_em = quando || new Date().toISOString();
        conversas.set(tel, c);
        mensagens.push({ wamid: String(m.id), telefone: tel, direcao: 'recebida', autor: 'pessoa', tipo: m.type || 'text', texto, ocorrido_em: quando, resposta_status: 'pendente' });
      }
      for (const e of v.message_echoes || []) {
        const tel = String(e.to || '').replace(/\D/g, '');
        if (!tel || !e.id) continue;
        const quando = carimboWa(e.timestamp);
        const c = conversas.get(tel) || { telefone: tel };
        c.ia_pausada_ate = new Date(Date.parse(quando || new Date().toISOString()) + PAUSA_HUMANO_MS).toISOString();
        conversas.set(tel, c);
        mensagens.push({ wamid: String(e.id), telefone: tel, direcao: 'enviada', autor: 'equipe', tipo: e.type || 'text', texto: textoDaMensagem(e), ocorrido_em: quando });
      }
      for (const s of v.statuses || []) {
        if (s?.id && s?.status) statuses.push({ wamid: String(s.id), status: String(s.status), erro: s.errors?.[0]?.title || null });
      }
    }
  }
  return { conversas: [...conversas.values()], mensagens, statuses };
}

export default async function handler(req, ctx) {
  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams;
    if (q.get('hub.mode') === 'subscribe' && VERIFY_TOKEN && q.get('hub.verify_token') === VERIFY_TOKEN) {
      return new Response(q.get('hub.challenge') || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    if (!q.get('hub.mode')) {
      const falta = [
        ['WA_APP_SECRET (ou IG_APP_SECRET, se for o mesmo app)', SEGREDOS.length > 0],
        ['WA_VERIFY_TOKEN', !!VERIFY_TOKEN],
        ['WA_TOKEN (envio)', !!process.env.WA_TOKEN],
        ['WA_PHONE_NUMBER_ID (envio)', !!process.env.WA_PHONE_NUMBER_ID],
      ].filter(([, ok]) => !ok).map(([n]) => n);
      return json({ ok: true, service: 'whatsapp-webhook', escuta: falta.filter((n) => !/envio/.test(n)).length === 0, responde: process.env.WA_BOT_ATIVO === '1', falta });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  if (!SB || !SVC) return json({ error: 'Supabase não configurado' }, 500);
  if (!SEGREDOS.length) { console.error('[wa] sem segredo de assinatura — entrega recusada'); return json({ error: 'Webhook não configurado' }, 500); }

  const bytes = await req.arrayBuffer();
  if (!(await assinaturaWaConfere(bytes, req.headers.get('x-hub-signature-256')))) {
    console.warn(`[wa] assinatura não fecha com nenhuma das ${SEGREDOS.length} chave(s)`);
    return json({ error: 'Não autorizado' }, 401);
  }
  let corpo;
  try { corpo = JSON.parse(new TextDecoder().decode(bytes)); }
  catch (e) { console.error('[wa] corpo assinado mas ilegível:', String(e?.message || e)); return json({ ok: true, ignorado: 'corpo_ilegivel' }); }

  const { conversas, mensagens, statuses } = lerEntregaWa(corpo);
  const agora = new Date().toISOString();
  try {
    // Conversa antes da mensagem (FK). merge-duplicates só atualiza as chaves PRESENTES — por isso
    // `nome`/`ia_pausada_ate` só entram quando esta entrega os trouxe (não apaga o que já havia).
    // Uma a uma: o upsert em lote do PostgREST exige as MESMAS chaves em todo objeto, e aqui
    // elas variam de propósito (entrega é pequena — normalmente 1 mensagem).
    for (const c of conversas) await sb('POST', 'wa_conversas?on_conflict=telefone', { ...c, atualizado_em: agora }, 'resolution=merge-duplicates,return=minimal');
    // ignore-duplicates: a Meta REENTREGA; o UNIQUE de wamid transforma reentrega em no-op.
    for (const m of mensagens) await sb('POST', 'wa_mensagens?on_conflict=wamid', m, 'resolution=ignore-duplicates,return=minimal');
    for (const s of statuses) {
      await sb('PATCH', `wa_mensagens?wamid=eq.${encodeURIComponent(s.wamid)}`, { status_entrega: s.status, ...(s.erro ? { resposta_erro: s.erro } : {}) }, 'return=minimal');
    }
  } catch (e) {
    // 500 de propósito: a Meta reentrega, e o UNIQUE garante que a segunda vez não duplica.
    console.error('[wa] gravação falhou:', e?.message || e);
    return json({ error: 'falha ao gravar' }, 500);
  }

  // Acorda o respondedor sem segurar o 200 da Meta. Sem `waitUntil` (ou se falhar), o cron de
  // 5 min pega a mesma fila — a pendência está no banco, não neste disparo.
  const recebidas = mensagens.filter((m) => m.direcao === 'recebida').length;
  if (recebidas && process.env.CRON_SECRET && typeof ctx?.waitUntil === 'function') {
    const base = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
    ctx.waitUntil(fetch(`${base}/api/whatsapp-responder`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } })
      .then((r) => { if (!r.ok) console.warn('[wa] respondedor devolveu', r.status, '— o cron cobre'); })
      .catch((e) => console.warn('[wa] não acordei o respondedor (o cron cobre):', e?.message || e)));
  }
  return json({ ok: true, mensagens: mensagens.length, statuses: statuses.length });
}
