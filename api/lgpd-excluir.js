export const config = { runtime: 'edge' };
import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbDelete(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'return=minimal' },
  });
}

function sbPatch(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = await checkRateLimit(`lgpd-excluir:${ip}`, 3, 60 * 60 * 1000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 });

  const userId = user.id;

  try {
    // Anonimiza dados pessoais em vez de excluir (mantém registros financeiros para compliance fiscal)
    await Promise.all([
      sbPatch(`perfis?id=eq.${userId}`, {
        nome: '[removido]',
        cpf: null,
        telefone: null,
        memoria_ia: null,
        ativo: false,
      }),
      sbDelete(`alertas_email?user_id=eq.${userId}`),
      sbDelete(`filtros_salvos?user_id=eq.${userId}`),
      sbDelete(`busca_historico?user_id=eq.${userId}`),
    ]);

    // Deleta o usuário do Auth (invalida todos os tokens)
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Erro ao excluir conta' }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, mensagem: 'Conta excluída com sucesso' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500 });
  }
}
