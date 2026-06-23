// Vercel Edge Function — proxy seguro para Claude API (chave nunca exposta no browser)
export const config = { runtime: 'edge' };
import { getUser, getUserRole, unauthorized, forbidden } from './_auth.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

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
  const { useSearch, ...claudePayload } = body;

  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  // Habilita web_search quando solicitado
  if (useSearch) {
    headers['anthropic-beta'] = 'web-search-2025-03-05';
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(claudePayload),
  });

  const data = await anthropicRes.json();

  return new Response(JSON.stringify(data), {
    status: anthropicRes.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
