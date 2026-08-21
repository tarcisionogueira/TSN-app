/**
 * POST /api/nps-alavancagem — resposta do CLIENTE à pesquisa (sem login; o token do
 * e-mail é a credencial). Body: { token, contratou, nota, comentario? }.
 * Uma resposta por lead; quem valida é o banco (nps_alavancagem_responder) — aqui só
 * se traduz a exceção em mensagem humana. Rate limit para o token não virar alvo de
 * força bruta (token de 48 hex já é inadivinhável; o limite é higiene).
 */
export const config = { runtime: 'edge' };

import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!SERVICE_KEY) return json({ error: 'Servidor não configurado' }, 500);
  const rl = await checkRateLimit(`nps:${getIP(req)}`, 10, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const token = String(b?.token || '').trim();
  if (!/^[0-9a-f]{40,64}$/i.test(token)) return json({ error: 'Link inválido ou expirado.' }, 404);
  const contratou = b?.contratou === true;
  const nota = Number.isInteger(b?.nota) ? b.nota : Number.parseInt(b?.nota, 10);
  if (!Number.isInteger(nota) || nota < 0 || nota > 10) return json({ error: 'Escolha uma nota de 0 a 10.' }, 400);
  const comentario = String(b?.comentario || '').slice(0, 1000);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/nps_alavancagem_responder`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token, p_contratou: contratou, p_nota: nota, p_comentario: comentario || null }),
  });
  if (res.ok) return json({ ok: true });

  const det = await res.text().catch(() => '');
  if (det.includes('ja_respondido')) return json({ error: 'Esta pesquisa já foi respondida — obrigado!' }, 409);
  if (det.includes('token_invalido')) return json({ error: 'Link inválido ou expirado.' }, 404);
  if (det.includes('nota_invalida')) return json({ error: 'Escolha uma nota de 0 a 10.' }, 400);
  console.error('[nps] resposta falhou', res.status, det.slice(0, 200));
  return json({ error: 'Não foi possível registrar agora. Tente novamente em instantes.' }, 500);
}
