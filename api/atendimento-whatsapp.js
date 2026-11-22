/**
 * POST /api/atendimento-whatsapp — a EQUIPE responde, na tela de Atendimento, um chamado que veio
 * do WhatsApp; a mensagem sai pelo WhatsApp (Evolution ou Cloud API, o canal ativo).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Corpo: { chamado_id, mensagem_id } — a mensagem JÁ foi gravada em `chamados_mensagens` pela
 * tela (mesmo fluxo das outras respostas). Aqui só se ENTREGA e se registra a prova:
 *  - envia o texto pelo canal ativo;
 *  - grava em `wa_mensagens` como 'equipe' COM `chamado_msg_id` (o gatilho de espelho pula essa
 *    linha — a mensagem já está no chamado, espelhar duplicaria);
 *  - pausa a IA nessa conversa por 12 h (humano assumiu).
 * Falhou o envio → 502 com o motivo do provedor; a tela avisa que a mensagem ficou só no chamado.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { enviarTextoWhatsapp, faltaParaEnviar } from './_whatsapp-envio.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const ROLES_STAFF = ['admin', 'analista', 'advogado', 'consultor'];
const PAUSA_HUMANO_MS = 12 * 3600 * 1000;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }
  if (!SB || !SVC) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  try {
    const [perfil] = (await sb('GET', `perfis?id=eq.${user.id}&select=role`)) || [];
    if (!perfil || !ROLES_STAFF.includes(perfil.role)) { res.status(403).json({ error: 'Apenas equipe' }); return; }

    const { chamado_id: chamadoId, mensagem_id: mensagemId } = req.body || {};
    if (!chamadoId || !mensagemId) { res.status(400).json({ error: 'chamado_id e mensagem_id obrigatórios' }); return; }

    const falta = faltaParaEnviar();
    if (falta.length) { res.status(503).json({ error: `WhatsApp não configurado (faltam: ${falta.join(', ')})` }); return; }

    const [msg] = (await sb('GET', `chamados_mensagens?id=eq.${encodeURIComponent(mensagemId)}&chamado_id=eq.${encodeURIComponent(chamadoId)}&select=id,conteudo,autor_tipo`)) || [];
    if (!msg || msg.autor_tipo !== 'atendente') { res.status(404).json({ error: 'Mensagem do atendente não encontrada neste chamado' }); return; }
    const [conv] = (await sb('GET', `wa_conversas?chamado_id=eq.${encodeURIComponent(chamadoId)}&select=telefone&limit=1`)) || [];
    if (!conv) { res.status(404).json({ error: 'Este chamado não está ligado a uma conversa de WhatsApp' }); return; }

    // Já entregue (duplo clique / reenvio): não manda duas vezes.
    const [ja] = (await sb('GET', `wa_mensagens?chamado_msg_id=eq.${encodeURIComponent(mensagemId)}&select=wamid&limit=1`)) || [];
    if (ja) { res.status(200).json({ ok: true, wamid: ja.wamid, repetido: true }); return; }

    const texto = String(msg.conteudo || '').trim();
    if (!texto || texto === '[anexo]') { res.status(400).json({ error: 'Por enquanto só texto sai pelo WhatsApp — escreva a mensagem (anexo fica no chamado).' }); return; }

    let wamid;
    try { wamid = await enviarTextoWhatsapp(conv.telefone, texto); }
    catch (e) { res.status(502).json({ error: String(e?.message || e).slice(0, 200) }); return; }

    const agora = new Date();
    await sb('POST', 'wa_mensagens?on_conflict=wamid', {
      wamid, telefone: conv.telefone, direcao: 'enviada', autor: 'equipe', texto, ocorrido_em: agora.toISOString(), chamado_msg_id: msg.id,
    }, 'resolution=ignore-duplicates,return=minimal');
    await sb('PATCH', `wa_conversas?telefone=eq.${encodeURIComponent(conv.telefone)}`, {
      ia_pausada_ate: new Date(agora.getTime() + PAUSA_HUMANO_MS).toISOString(), atualizado_em: agora.toISOString(),
    }, 'return=minimal');
    res.status(200).json({ ok: true, wamid });
  } catch (e) {
    console.error('[atend-wa]', e?.message || e);
    res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
  }
}
