/**
 * /api/whatsapp-evolution-webhook — ESCUTA do WhatsApp via EVOLUTION API (QR code). Grava e sai.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Gêmeo do `whatsapp-webhook.js` (Cloud API oficial): grava nas MESMAS tabelas
 * (`wa_conversas`/`wa_mensagens`) e acorda o MESMO respondedor. A IA, o perfil do lead, o funil e
 * o histórico não sabem por qual porta a mensagem entrou — é isso que permite trocar para a
 * oficial depois só mudando `WA_CANAL` (ver `api/_whatsapp-envio.js`).
 *
 * EVENTOS (configurar na instância: MESSAGES_UPSERT, MESSAGES_UPDATE, CONNECTION_UPDATE):
 *  - messages.upsert, fromMe=false → a PESSOA escreveu: 'recebida', `resposta_status='pendente'`;
 *  - messages.upsert, fromMe=true  → saiu do NOSSO número. Se o id já está gravado, foi a IA ou a
 *    fila (o envio grava o id que a Evolution devolve) → nada a fazer. Se não está, foi a EQUIPE
 *    pelo celular → grava como 'equipe' e PAUSA a IA 12 h, igual ao echo da coexistência oficial.
 *    Como o eco pode chegar ANTES de o envio gravar o id, olhamos de novo após 2,5 s;
 *  - messages.update → sent/delivered/read da nossa mensagem;
 *  - connection.update → estado da sessão em `wa_canal_estado` (o cron de disparos avisa o dono
 *    por e-mail quando cai — o chip do número atual está INATIVO, queda é risco real).
 *
 * Ignora grupo (@g.us), status (status@broadcast) e canal (@newsletter): o bot é 1-para-1.
 *
 * AUTENTICAÇÃO (o repositório é público — nomes, nunca valores). Aceita QUALQUER uma:
 *  - header `x-webhook-token` = WA_EVOLUTION_WEBHOOK_TOKEN (configure em "headers" do webhook);
 *  - campo `apikey` do corpo (a Evolution manda o token da instância em toda entrega) =
 *    EVOLUTION_APIKEY, quando essa env é o token da instância.
 * Sem nenhum dos dois configurados, recusa tudo: webhook aberto é `insert` público.
 */
export const config = { runtime: 'edge' };

import { timingSafeEqualStr } from './_auth.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
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

export function autorizadoEvolution(headerToken, corpoApikey, env = process.env) {
  const tok = env.WA_EVOLUTION_WEBHOOK_TOKEN;
  if (tok && headerToken && timingSafeEqualStr(String(headerToken), tok)) return true;
  const key = env.EVOLUTION_APIKEY;
  if (key && corpoApikey && timingSafeEqualStr(String(corpoApikey), key)) return true;
  return false;
}

/** `messageTimestamp` vem em segundos (número, string ou {low,high} do protobuf). */
export function carimboEvolution(v) {
  const n = typeof v === 'object' && v ? Number(v.low) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e11 ? n * 1000 : n;
  if (ms < 978307200000 || ms > 4102444800000) return null;
  return new Date(ms).toISOString();
}

/**
 * Quem é a pessoa da conversa. Telefone (só dígitos) quando dá; o JID `@lid` inteiro quando o
 * WhatsApp esconde o número e a Evolution não mandou o alternativo — o envio aceita o JID.
 * null = não é conversa 1-para-1 (grupo, status, canal).
 */
export function contatoDoJid(key = {}) {
  const jid = String(key.remoteJid || '');
  if (!jid || /@(g\.us|broadcast|newsletter)$/.test(jid) || jid === 'status@broadcast') return null;
  if (jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0].replace(/\D/g, '') || null;
  if (jid.endsWith('@lid')) {
    const alt = String(key.remoteJidAlt || key.senderPn || '');
    if (alt.endsWith('@s.whatsapp.net')) return alt.split('@')[0].replace(/\D/g, '') || null;
    return jid;
  }
  return null;
}

/** Texto legível de qualquer tipo. Mídia vira marcador; reação/protocolo = null (não responder). */
export function textoEvolution(msg) {
  if (!msg || typeof msg !== 'object') return null;
  // Envelopes: mensagem temporária / visualização única carregam a real dentro.
  const m = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message
    || msg.documentWithCaptionMessage?.message || msg;
  if (typeof m.conversation === 'string') return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.buttonsResponseMessage) return m.buttonsResponseMessage.selectedDisplayText || m.buttonsResponseMessage.selectedButtonId || '[botão]';
  if (m.listResponseMessage) return m.listResponseMessage.title || m.listResponseMessage.singleSelectReply?.selectedRowId || '[lista]';
  if (m.templateButtonReplyMessage) return m.templateButtonReplyMessage.selectedDisplayText || '[botão]';
  if (m.reactionMessage || m.protocolMessage || m.senderKeyDistributionMessage && Object.keys(m).length === 1) return null;
  const midias = [['imageMessage', 'imagem'], ['videoMessage', 'vídeo'], ['audioMessage', 'áudio'], ['documentMessage', 'documento'], ['stickerMessage', 'figurinha']];
  for (const [k, rotulo] of midias) {
    if (m[k]) {
      const leg = m[k].caption || (k === 'documentMessage' ? m[k].fileName : null);
      return `[${rotulo}${leg ? `: ${String(leg).slice(0, 300)}` : ''}]`;
    }
  }
  if (m.locationMessage || m.liveLocationMessage) return '[localização]';
  if (m.contactMessage || m.contactsArrayMessage) return '[contato]';
  return null;
}

const STATUS_EVO = { SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed', PENDING: null };

/** Extrai tudo de uma entrega da Evolution. Função pura (testável sem rede). */
export function lerEntregaEvolution(corpo) {
  const evento = String(corpo?.event || '').toLowerCase().replace(/_/g, '.');
  const itens = Array.isArray(corpo?.data) ? corpo.data : corpo?.data ? [corpo.data] : [];
  const conversas = new Map();
  const mensagens = [];
  const ecos = [];          // fromMe: decidir depois (IA/fila já gravou? senão é a equipe)
  const statuses = [];
  let conexao = null;

  if (evento === 'messages.upsert') {
    for (const d of itens) {
      const key = d?.key || {};
      const tel = contatoDoJid(key);
      const id = key.id ? String(key.id) : null;
      if (!tel || !id) continue;
      const texto = textoEvolution(d.message);
      if (texto == null) continue;
      const quando = carimboEvolution(d.messageTimestamp);
      if (key.fromMe) {
        ecos.push({ wamid: id, telefone: tel, direcao: 'enviada', autor: 'equipe', tipo: d.messageType || 'text', texto, ocorrido_em: quando });
        continue;
      }
      const c = conversas.get(tel) || { telefone: tel };
      if (d.pushName) c.nome = String(d.pushName).slice(0, 120);
      if (!c.ultima_msg_deles_em || (quando || '') > c.ultima_msg_deles_em) c.ultima_msg_deles_em = quando || new Date().toISOString();
      conversas.set(tel, c);
      mensagens.push({ wamid: id, telefone: tel, direcao: 'recebida', autor: 'pessoa', tipo: d.messageType || 'text', texto, ocorrido_em: quando, resposta_status: 'pendente' });
    }
  } else if (evento === 'messages.update') {
    for (const d of itens) {
      const id = d?.keyId || d?.key?.id || d?.messageId;
      const st = STATUS_EVO[String(d?.status || '').toUpperCase()];
      if (id && st) statuses.push({ wamid: String(id), status: st });
    }
  } else if (evento === 'connection.update') {
    const st = itens[0]?.state || corpo?.data?.state;
    if (st) conexao = String(st);
  }
  return { evento, conversas: [...conversas.values()], mensagens, ecos, statuses, conexao };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function idJaGravado(wamid) {
  const r = await sb('GET', `wa_mensagens?wamid=eq.${encodeURIComponent(wamid)}&select=id&limit=1`);
  return Array.isArray(r) && r.length > 0;
}

export default async function handler(req, ctx) {
  if (req.method === 'GET') {
    const falta = [
      ['WA_EVOLUTION_WEBHOOK_TOKEN ou EVOLUTION_APIKEY (autenticar a entrega)', !!(process.env.WA_EVOLUTION_WEBHOOK_TOKEN || process.env.EVOLUTION_APIKEY)],
      ['EVOLUTION_URL (envio)', !!process.env.EVOLUTION_URL],
      ['EVOLUTION_APIKEY (envio)', !!process.env.EVOLUTION_APIKEY],
      ['EVOLUTION_INSTANCIA (envio)', !!process.env.EVOLUTION_INSTANCIA],
    ].filter(([, ok]) => !ok).map(([n]) => n);
    return json({ ok: true, service: 'whatsapp-evolution-webhook', escuta: !falta.some((n) => /autenticar/.test(n)), responde: process.env.WA_BOT_ATIVO === '1', falta });
  }
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  if (!SB || !SVC) return json({ error: 'Supabase não configurado' }, 500);
  if (!process.env.WA_EVOLUTION_WEBHOOK_TOKEN && !process.env.EVOLUTION_APIKEY) {
    console.error('[wa-evo] sem segredo de autenticação — entrega recusada');
    return json({ error: 'Webhook não configurado' }, 500);
  }

  let corpo;
  try { corpo = await req.json(); } catch { return json({ error: 'corpo ilegível' }, 400); }
  if (!autorizadoEvolution(req.headers.get('x-webhook-token'), corpo?.apikey)) {
    console.warn('[wa-evo] entrega sem token válido');
    return json({ error: 'Não autorizado' }, 401);
  }
  // Outra instância no mesmo servidor Evolution: não é conosco.
  if (process.env.EVOLUTION_INSTANCIA && corpo?.instance && corpo.instance !== process.env.EVOLUTION_INSTANCIA) {
    return json({ ok: true, ignorado: 'outra_instancia' });
  }

  const { conversas, mensagens, ecos, statuses, conexao } = lerEntregaEvolution(corpo);
  const agora = new Date().toISOString();
  try {
    for (const c of conversas) await sb('POST', 'wa_conversas?on_conflict=telefone', { ...c, atualizado_em: agora }, 'resolution=merge-duplicates,return=minimal');
    for (const m of mensagens) await sb('POST', 'wa_mensagens?on_conflict=wamid', m, 'resolution=ignore-duplicates,return=minimal');
    for (const s of statuses) await sb('PATCH', `wa_mensagens?wamid=eq.${encodeURIComponent(s.wamid)}`, { status_entrega: s.status }, 'return=minimal');
    if (conexao) {
      await sb('POST', 'wa_canal_estado?on_conflict=canal', { canal: 'evolution', estado: conexao, atualizado_em: agora }, 'resolution=merge-duplicates,return=minimal');
    }
    for (const e of ecos) {
      if (await idJaGravado(e.wamid)) continue;          // a IA ou a fila mandou — já está no histórico
      await espera(2500);                                   // o envio pode ainda não ter gravado o id
      if (await idJaGravado(e.wamid)) continue;
      // Ninguém daqui mandou: foi a equipe pelo celular. Grava e pausa a IA nessa conversa.
      await sb('POST', 'wa_conversas?on_conflict=telefone', {
        telefone: e.telefone, ia_pausada_ate: new Date(Date.now() + PAUSA_HUMANO_MS).toISOString(), atualizado_em: agora,
      }, 'resolution=merge-duplicates,return=minimal');
      await sb('POST', 'wa_mensagens?on_conflict=wamid', e, 'resolution=ignore-duplicates,return=minimal');
    }
  } catch (err) {
    // 500 de propósito: a Evolution reenvia, e o UNIQUE do wamid garante que não duplica.
    console.error('[wa-evo] gravação falhou:', err?.message || err);
    return json({ error: 'falha ao gravar' }, 500);
  }

  if (mensagens.length && process.env.CRON_SECRET && typeof ctx?.waitUntil === 'function') {
    const base = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
    ctx.waitUntil(fetch(`${base}/api/whatsapp-responder`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } })
      .then((r) => { if (!r.ok) console.warn('[wa-evo] respondedor devolveu', r.status, '— o cron cobre'); })
      .catch((err) => console.warn('[wa-evo] não acordei o respondedor (o cron cobre):', err?.message || err)));
  }
  return json({ ok: true, mensagens: mensagens.length, ecos: ecos.length, statuses: statuses.length, conexao });
}
