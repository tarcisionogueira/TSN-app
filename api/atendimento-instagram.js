/**
 * POST /api/atendimento-instagram — a EQUIPE responde, na tela de Atendimento, um chamado que veio do
 * direct do Instagram; a mensagem sai pelo direct (Send API). Mesmo desenho de atendimento-whatsapp.js.
 * Corpo: { chamado_id, mensagem_id } — a mensagem JÁ está em `chamados_mensagens`; aqui só se entrega
 * e se registra a prova em `ig_mensagens` (autor 'dono', COM `chamado_msg_id`: o espelho pula a linha).
 * A Meta só aceita resposta até 24 h depois da última mensagem da pessoa: fora disso devolve o erro
 * dela, e a tela avisa que a mensagem ficou só no chamado.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { envioConfigurado, enviarDM } from './_instagram-envio.js';

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
    if (!envioConfigurado()) { res.status(503).json({ error: 'Instagram não configurado (faltam IG_USER_ID/IG_PAGE_TOKEN)' }); return; }

    const [msg] = (await sb('GET', `chamados_mensagens?id=eq.${encodeURIComponent(mensagemId)}&chamado_id=eq.${encodeURIComponent(chamadoId)}&select=id,conteudo,autor_tipo`)) || [];
    if (!msg || msg.autor_tipo !== 'atendente') { res.status(404).json({ error: 'Mensagem do atendente não encontrada neste chamado' }); return; }
    const [conv] = (await sb('GET', `ig_conversas?chamado_id=eq.${encodeURIComponent(chamadoId)}&select=ig_user_id&limit=1`)) || [];
    if (!conv) { res.status(404).json({ error: 'Este chamado não está ligado a uma conversa do Instagram' }); return; }

    const [ja] = (await sb('GET', `ig_mensagens?chamado_msg_id=eq.${encodeURIComponent(mensagemId)}&select=mid&limit=1`)) || [];
    if (ja) { res.status(200).json({ ok: true, mid: ja.mid, repetido: true }); return; }

    const texto = String(msg.conteudo || '').trim();
    if (!texto || texto === '[anexo]') { res.status(400).json({ error: 'Por enquanto só texto sai pelo Instagram — escreva a mensagem (anexo fica no chamado).' }); return; }

    const r = await enviarDM(conv.ig_user_id, texto);
    if (!r.ok) { res.status(502).json({ error: `${r.erro}${r.detalhe ? `: ${r.detalhe}` : ''}`.slice(0, 250) }); return; }

    const agora = new Date();
    await sb('POST', 'ig_mensagens?on_conflict=mid', {
      mid: r.message_id, ig_user_id: conv.ig_user_id, direcao: 'enviada', origem: 'dm', autor: 'dono',
      texto, ocorrido_em: agora.toISOString(), respondida: true, chamado_msg_id: msg.id,
    }, 'resolution=ignore-duplicates,return=minimal');
    await sb('PATCH', `ig_conversas?ig_user_id=eq.${encodeURIComponent(conv.ig_user_id)}`, {
      ia_pausada_ate: new Date(agora.getTime() + PAUSA_HUMANO_MS).toISOString(), atualizado_em: agora.toISOString(),
    }, 'return=minimal');
    res.status(200).json({ ok: true, mid: r.message_id });
  } catch (e) {
    console.error('[atend-ig]', e?.message || e);
    res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
  }
}
