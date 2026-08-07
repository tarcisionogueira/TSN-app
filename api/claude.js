// Vercel Function (Node) — proxy seguro para Claude API (chave nunca exposta no browser).
// Node + maxDuration porque a análise mercadológica usa web search e passa dos 25s do
// Edge (que estourava 504). IMPORTANTE: o runtime Node deste projeto usa a assinatura
// (req, res) — responder via res.* (um `return new Response()` seria IGNORADO e a
// função travaria até o timeout).
export const config = { runtime: 'nodejs', maxDuration: 120 };
import { getUser } from './_auth.js';
import { checkRateLimit } from './_rate-limit.js';
import { anthropicFetch } from './_claude.js';

const MODELOS_PERMITIDOS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'];

export default async function handler(req, res) {
  const origin = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const rl = await checkRateLimit(`claude:${ip}`, 30, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas requisições. Aguarde alguns segundos.' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return res.status(500).json({ error: 'CLAUDE_KEY not configured' });

  const body = req.body || {};
  const { useSearch, messages, tools, system, model, max_tokens } = body;

  // Campos críticos fixos no servidor — cliente não pode sobrescrever modelo/tokens.
  const modeloSolicitado = model && MODELOS_PERMITIDOS.includes(model) ? model : 'claude-haiku-4-5-20251001';
  const maxTokensSafe = Math.min(Number(max_tokens) || 1024, 8192);

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
  if (useSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';

  try {
    // TIMEOUT MENOR QUE O maxDuration (07/08). Sem opções, este call site herdava
    // `retries=3, timeoutMs=120000` — exatamente o `maxDuration: 120` desta função. Os dois
    // números iguais significam que a Vercel matava a invocação no mesmo instante em que a
    // 1ª tentativa expiraria: o trabalho do outro lado já tinha sido feito e COBRADO, o
    // resultado ia para o lixo, e nem o medidor nem a linha `abortada` do anthropicFetch
    // chegavam a rodar (o processo morre antes do catch) — gasto 100% invisível.
    // `retries: 0` porque com 120s de teto não cabe uma 2ª tentativa; 100s deixa folga para
    // esta função responder o erro ao cliente em vez de morrer calada.
    const anthropicRes = await anthropicFetch({
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, { retries: 0, timeoutMs: 100000 });
    const data = await anthropicRes.json();
    return res.status(anthropicRes.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'Falha ao chamar a IA', detalhe: String(e?.message || e) });
  }
}
