/**
 * /api/whatsapp-responder — a IA que RESPONDE no WhatsApp oficial (receptivo).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Acordado pelo `whatsapp-webhook.js` a cada mensagem (latência de segundos) e por cron de
 * 5 min (rede de segurança). Lê `wa_mensagens` pendentes, agrupa por conversa e responde UMA
 * vez cobrindo tudo que a pessoa mandou em sequência.
 *
 * O AGENTE É O MESMO DO CHAT DO SITE (`responderSuporte` em chat-suporte.js, canal
 * 'whatsapp'): mesmas regras de privacidade, mesmos planos, mesmo marcador de escalar. Não
 * existe "IA do WhatsApp" separada para divergir da do site.
 *
 * QUANDO NÃO RESPONDE (e grava o PORQUÊ em `resposta_erro`, nunca some calado):
 *  - `WA_BOT_ATIVO` ≠ '1'      → dormente: não reivindica nada, só conta a fila;
 *  - humano assumiu (`ia_pausada_ate` no futuro: escalou, ou a equipe respondeu pelo app);
 *  - fora da janela de 24 h da última mensagem da pessoa (a Meta só aceita modelo aprovado).
 *
 * ESCALAR ([[ESCALAR]]/[[BUG]] do agente): a resposta sai (o agente avisa que um especialista
 * vai responder), a IA PAUSA 12 h naquela conversa e o dono recebe e-mail com o telefone e a
 * última mensagem — ele responde pelo app WhatsApp Business (coexistência) e o echo mantém a
 * pausa viva.
 *
 * ENVS (nomes, nunca valores): WA_BOT_ATIVO, WA_TOKEN (token permanente de usuário do sistema),
 * WA_PHONE_NUMBER_ID, CLAUDE_KEY, CRON_SECRET, ADMIN_ALERT_EMAIL (opcional).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { responderSuporte } from './chat-suporte.js';
import { enviarEmail } from './_email.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const GRAPH = 'https://graph.facebook.com/v21.0';
const JANELA_MS = 24 * 3600 * 1000;
const PAUSA_ESCALADA_MS = 12 * 3600 * 1000;
const ORCAMENTO_MS = 45000;

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

/** Variantes do telefone para achar o perfil (cadastro guarda com/sem DDI, com/sem máscara). */
export function variantesTelefone(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  const semDdi = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  const vs = new Set([d, semDdi, `55${semDdi}`]);
  // Celular com 9º dígito: a Meta às vezes entrega SEM ele (número antigo) — tenta os dois.
  if (semDdi.length === 10) vs.add(`${semDdi.slice(0, 2)}9${semDdi.slice(2)}`);
  if (semDdi.length === 11 && semDdi[2] === '9') vs.add(`${semDdi.slice(0, 2)}${semDdi.slice(3)}`);
  if (semDdi.length === 11) vs.add(`(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 7)}-${semDdi.slice(7)}`);
  return [...vs].filter((v) => v.replace(/\D/g, '').length >= 10);
}

/** Envia texto pela Cloud API. Devolve o wamid, ou lança com o motivo da Meta (erro vem no corpo). */
export async function enviarTextoWa(para, texto, { token = process.env.WA_TOKEN, phoneId = process.env.WA_PHONE_NUMBER_ID, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: true } }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => null);
  // `.ok` não basta sozinho: sem `messages[0].id` não há prova de que a Meta aceitou (forma nº 1).
  const wamid = j?.messages?.[0]?.id;
  if (!r.ok || !wamid) throw new Error(`Meta ${r.status}: ${j?.error?.message || 'sem id da mensagem'}`.slice(0, 200));
  return wamid;
}

async function marcar(ids, patch) {
  if (!ids.length) return;
  await sb('PATCH', `wa_mensagens?id=in.(${ids.join(',')})`, patch, 'return=minimal');
}

async function atender(tel, pendentes) {
  const ids = pendentes.map((m) => m.id);
  // Reivindica: só o que AINDA está pendente vira 'processando' — dois disparos simultâneos
  // (webhook + cron) não respondem a mesma mensagem duas vezes.
  const minhas = await sb('PATCH', `wa_mensagens?id=in.(${ids.join(',')})&resposta_status=eq.pendente&select=id`,
    { resposta_status: 'processando' }, 'return=representation');
  const meus = (minhas || []).map((m) => m.id);
  if (!meus.length) return 'ja_reivindicada';

  const [conv] = await sb('GET', `wa_conversas?telefone=eq.${encodeURIComponent(tel)}&select=*`) || [];
  const agora = Date.now();
  if (conv?.ia_pausada_ate && Date.parse(conv.ia_pausada_ate) > agora) {
    await marcar(meus, { resposta_status: 'ignorada', resposta_erro: 'humano assumiu a conversa' });
    return 'pausada';
  }
  if (!conv?.ultima_msg_deles_em || agora - Date.parse(conv.ultima_msg_deles_em) > JANELA_MS) {
    await marcar(meus, { resposta_status: 'ignorada', resposta_erro: 'fora da janela de 24h' });
    return 'fora_janela';
  }

  // Quem é: perfil pelo telefone (uma vez; depois fica em wa_conversas.user_id).
  let perfil = null;
  try {
    if (conv.user_id) [perfil] = await sb('GET', `perfis?id=eq.${conv.user_id}&select=id,nome,role`) || [];
    else {
      const vs = variantesTelefone(tel).map((v) => `"${v}"`).join(',');
      const achados = await sb('GET', `perfis?telefone=in.(${encodeURIComponent(vs)})&select=id,nome,role&limit=2`) || [];
      if (achados.length === 1) {
        perfil = achados[0];
        await sb('PATCH', `wa_conversas?telefone=eq.${encodeURIComponent(tel)}`, { user_id: perfil.id }, 'return=minimal');
      }
    }
  } catch (e) { console.warn('[wa-resp] perfil não resolvido (segue como contato novo):', e?.message || e); }
  const memoria = perfil
    ? `Cliente cadastrado: ${perfil.nome || 'sem nome'} · plano atual: ${perfil.role || 'desconhecido'}.`
    : `Contato ainda NÃO cadastrado na plataforma${conv.nome ? ` (nome no WhatsApp: ${conv.nome})` : ''} — provável cliente novo.`;

  const hist = await sb('GET', `wa_mensagens?telefone=eq.${encodeURIComponent(tel)}&select=autor,texto&order=criado_em.desc&limit=20`) || [];
  const mensagens = hist.reverse().filter((m) => m.texto)
    .map((m) => ({ autor_tipo: m.autor === 'pessoa' ? 'cliente' : m.autor === 'ia' ? 'ia' : 'equipe', conteudo: m.texto }));

  let out;
  try { out = await responderSuporte({ mensagens, memoria, canal: 'whatsapp', apiKey: process.env.CLAUDE_KEY }); }
  catch (e) {
    await marcar(meus, { resposta_status: 'erro', resposta_erro: `IA: ${String(e?.message || e).slice(0, 150)}` });
    return 'erro_ia';
  }
  if (!out?.resposta) { await marcar(meus, { resposta_status: 'ignorada', resposta_erro: 'agente sem resposta (última fala não é da pessoa)' }); return 'sem_resposta'; }

  let wamid;
  try { wamid = await enviarTextoWa(tel, out.resposta); }
  catch (e) {
    await marcar(meus, { resposta_status: 'erro', resposta_erro: String(e?.message || e).slice(0, 200) });
    return 'erro_envio';
  }
  await sb('POST', 'wa_mensagens?on_conflict=wamid', { wamid, telefone: tel, direcao: 'enviada', autor: 'ia', texto: out.resposta, ocorrido_em: new Date().toISOString() }, 'resolution=ignore-duplicates,return=minimal');
  await marcar(meus, { resposta_status: 'respondida', resposta_erro: null });

  if (out.escalar) {
    const motivo = out.bug ? 'falha relatada (BUG)' : 'pedido de atendimento humano';
    await sb('PATCH', `wa_conversas?telefone=eq.${encodeURIComponent(tel)}`, {
      escalada_em: new Date().toISOString(), escalada_motivo: motivo,
      ia_pausada_ate: new Date(agora + PAUSA_ESCALADA_MS).toISOString(),
    }, 'return=minimal');
    const ultima = pendentes[pendentes.length - 1]?.texto || '';
    const env = await enviarEmail({
      to: process.env.ADMIN_ALERT_EMAIL || 'tarcisioaraujo@reimob.com.br',
      subject: `WhatsApp: ${conv.nome || perfil?.nome || tel} precisa de você (${motivo})`,
      html: `<p><b>${conv.nome || perfil?.nome || 'Contato'}</b> — +${tel}${perfil ? ` · cliente (${perfil.role})` : ' · ainda não cadastrado'}</p>
             <p><b>Última mensagem:</b><br>${String(ultima).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>
             <p>A IA avisou que um especialista vai responder e ficou PAUSADA por 12 h nesta conversa. Responda pelo app WhatsApp Business: <a href="https://wa.me/${tel}">abrir conversa</a>.</p>`,
      meta: { tipo: 'whatsapp_escalada', userId: perfil?.id || null },
    }).catch((e) => ({ ok: false, error: e?.message }));
    if (!env?.ok) console.error('[wa-resp] aviso de escalada NÃO saiu:', env?.error || 'motivo desconhecido');
    return 'respondida_escalada';
  }
  return 'respondida';
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SB || !SVC) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // Reivindicada e abandonada (a função morreu no meio): volta para a fila. 15 min é muito
  // acima do orçamento de uma rodada (45 s), então não pega trabalho de outra em andamento.
  if (process.env.WA_BOT_ATIVO === '1') {
    await sb('PATCH', `wa_mensagens?resposta_status=eq.processando&criado_em=lt.${new Date(Date.now() - 15 * 60000).toISOString()}`,
      { resposta_status: 'pendente' }, 'return=minimal').catch((e) => console.warn('[wa-resp] não devolvi as abandonadas:', e?.message || e));
  }
  const fila = await sb('GET', 'wa_mensagens?resposta_status=eq.pendente&select=id,telefone,texto,criado_em&order=criado_em.asc&limit=60')
    .catch((e) => ({ erro: e.message }));
  if (fila?.erro) { res.status(502).json({ ok: false, erro: fila.erro }); return; }

  if (process.env.WA_BOT_ATIVO !== '1') { res.status(200).json({ ok: true, dormente: true, pendentes: fila.length }); return; }
  const faltam = ['WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'CLAUDE_KEY'].filter((n) => !process.env[n]);
  // Ligado sem credencial NÃO é "nada a fazer": é falha de configuração, e tem de aparecer.
  if (faltam.length) { res.status(500).json({ ok: false, erro: 'configuração incompleta', faltam, pendentes: fila.length }); return; }

  const porTel = new Map();
  for (const m of fila) porTel.set(m.telefone, [...(porTel.get(m.telefone) || []), m]);
  const t0 = Date.now();
  const resultado = {};
  for (const [tel, pend] of porTel) {
    if (Date.now() - t0 > ORCAMENTO_MS) { resultado.sem_tempo = (resultado.sem_tempo || 0) + 1; continue; }
    const r = await atender(tel, pend).catch((e) => { console.error('[wa-resp]', tel, e?.message || e); return 'erro'; });
    resultado[r] = (resultado[r] || 0) + 1;
  }
  console.log('[wa-resp]', JSON.stringify(resultado));
  res.status(200).json({ ok: true, conversas: porTel.size, ...resultado });
}
