/**
 * POST /api/duvida  (público, sem login)
 * Dúvida de quem ainda não tem conta. Captura nome/email/telefone:
 *  1. Registra/atualiza o LEAD em sdr_leads (sem duplicar por email/whatsapp).
 *  2. Abre um CHAMADO (chamados + chamados_mensagens) para o consultor ver na
 *     tela de Atendimento e responder — a resposta de encerramento vai ao
 *     e-mail do cliente pelo fluxo do Atendimento.
 */
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
}
function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors() } });
}
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors() });

  // Rate limit por IP: endpoint público que grava com service key (bypassa RLS) —
  // limita flood de leads/chamados. 5/min por IP (fail-open se o Redis cair).
  const rl = await checkRateLimit(`duvida:${getIP(req)}`, 5, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const nome = String(body.nome || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
  const telefone = onlyDigits(body.telefone).slice(0, 15);
  const mensagem = String(body.mensagem || '').trim().slice(0, 2000);
  const origem = String(body.origem || 'duvida_planos').slice(0, 40);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Informe um e-mail válido para receber a resposta.' }, 400);
  if (mensagem.length < 5) return json({ error: 'Escreva sua dúvida.' }, 400);

  // 1. LEAD — não duplica (busca por email ou whatsapp)
  try {
    const filtros = [`email.eq.${encodeURIComponent(email)}`];
    if (telefone) filtros.push(`whatsapp.eq.${encodeURIComponent(telefone)}`);
    const existentes = await (await sb(`sdr_leads?or=(${filtros.join(',')})&select=id,nome,whatsapp&limit=1`)).json();
    if (Array.isArray(existentes) && existentes.length) {
      // Atualiza dados que estavam vazios, sem criar novo lead
      const lead = existentes[0];
      const patch = {};
      if (!lead.nome && nome) patch.nome = nome;
      if (!lead.whatsapp && telefone) patch.whatsapp = telefone;
      if (Object.keys(patch).length) {
        await sb(`sdr_leads?id=eq.${lead.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      }
    } else {
      await sb('sdr_leads', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ nome, email, whatsapp: telefone || null, origem, status: 'novo' }) });
    }
  } catch (_) {}

  // 2. CHAMADO + 1ª mensagem (consultor responde pelo Atendimento)
  try {
    const titulo = (mensagem.length > 70 ? mensagem.slice(0, 67) + '…' : mensagem) || 'Dúvida sobre planos';
    const chamadoRes = await sb('chamados', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: null, user_email: email, user_nome: nome || email, titulo, status: 'aberto', segmento: 'curioso' }),
    });
    const [chamado] = await chamadoRes.json();
    if (chamado?.id) {
      await sb('chamados_mensagens', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          chamado_id: chamado.id,
          autor_tipo: 'cliente',
          autor_nome: nome || email,
          remetente_role: 'cliente',
          conteudo: `${mensagem}${telefone ? `\n\n(Telefone: ${telefone})` : ''}`,
        }),
      });
    }
  } catch (e) {
    return json({ error: 'Não foi possível registrar sua dúvida agora. Tente novamente.' }, 500);
  }

  return json({ ok: true });
}
