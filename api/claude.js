// Vercel Edge Function — proxy seguro para Claude API (chave nunca exposta no browser)
export const config = { runtime: 'edge' };
import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = checkRateLimit(`claude:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'CLAUDE_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { useSearch, messages, tools, system, model, max_tokens } = body;

  // Campos críticos fixos no servidor — cliente não pode sobrescrever modelo, tokens ou system prompt
  const MODELOS_PERMITIDOS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'];
  const modeloSolicitado = model && MODELOS_PERMITIDOS.includes(model) ? model : 'claude-haiku-4-5-20251001';
  const maxTokensSafe = Math.min(Number(max_tokens) || 1024, 4096);

  const payload = {
    model: modeloSolicitado,
    max_tokens: maxTokensSafe,
    messages,
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
  };

  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  if (useSearch) {
    headers['anthropic-beta'] = 'web-search-2025-03-05';
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await anthropicRes.json();

  return new Response(JSON.stringify(data), {
    status: anthropicRes.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
    },
  });
}
