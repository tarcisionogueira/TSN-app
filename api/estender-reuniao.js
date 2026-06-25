export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const DAILY_API = 'https://api.daily.co/v1';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = checkRateLimit(`estender-reuniao:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  const role = await getUserRoleById(user.id);
  if (!['admin', 'consultor', 'analista', 'advogado'].includes(role)) return forbidden('Apenas consultores podem estender reuniões');

  const DAILY_KEY = process.env.DAILY_API_KEY;
  if (!DAILY_KEY) return new Response(JSON.stringify({ error: 'DAILY_API_KEY não configurada' }), { status: 500 });

  const body = await req.json();
  const { roomName } = body;
  const minutosExtras = Math.min(Math.max(1, Number(body.minutosExtras) || 30), 120);
  if (!roomName) return new Response(JSON.stringify({ error: 'roomName obrigatório' }), { status: 400 });

  // Busca a sala atual para saber o exp atual
  const getRes = await fetch(`${DAILY_API}/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${DAILY_KEY}` },
  });
  if (!getRes.ok) return new Response(JSON.stringify({ error: 'Sala não encontrada' }), { status: 404 });

  const sala = await getRes.json();
  const expAtual = sala.config?.exp || Math.floor(Date.now() / 1000);
  // Extende a partir do maior entre agora e o exp atual
  const base = Math.max(expAtual, Math.floor(Date.now() / 1000));
  const novoExp = base + minutosExtras * 60;

  const upRes = await fetch(`${DAILY_API}/rooms/${roomName}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DAILY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { exp: novoExp } }),
  });

  if (!upRes.ok) {
    const err = await upRes.text();
    return new Response(JSON.stringify({ error: 'Erro ao estender sala', detail: err }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, novoExp, novaExpiracao: new Date(novoExp * 1000).toLocaleString('pt-BR') }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
