export const config = { runtime: 'edge' };
import { getUser, getUserRole, unauthorized, forbidden } from './_auth.js';

const DAILY_API = 'https://api.daily.co/v1';

export default async function handler(req) {

  const user = await getUser(req);
  if (!user) return unauthorized();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const DAILY_KEY = process.env.DAILY_API_KEY;
  if (!DAILY_KEY) return new Response(JSON.stringify({ error: 'DAILY_API_KEY não configurada' }), { status: 500 });

  const { roomName, minutosExtras = 30 } = await req.json();
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
