export const config = { runtime: 'edge' };

// COMPLEMENTAR os pontos de autenticação de um contrato JÁ ASSINADO (padrão ZapSign): quando a
// assinatura foi feita ANTES de o sistema passar a capturar dispositivo/localização, o próprio
// signatário (abrindo o link do documento) pode completar esses dados AGORA — sem re-assinar, sem
// tocar a assinatura/hash/carimbo originais. Marca dados_complementados_em para rotular com
// honestidade que dispositivo/localização foram registrados após a assinatura.
//
// Token-gated (link do próprio signatário), service key. Idempotente: só grava o que falta.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500, headers });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const { token, geo } = body || {};
  if (!token || !/^[A-Za-z0-9_-]{8,128}$/.test(String(token))) {
    return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 400, headers });
  }

  const userAgent = req.headers.get('user-agent')?.slice(0, 400) || null;
  const geoOk = geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lng))
    ? { lat: Number(geo.lat), lng: Number(geo.lng) } : null;
  if (!userAgent && !geoOk) return new Response(JSON.stringify({ error: 'Nada a complementar' }), { status: 400, headers });

  // Carrega a linha do token (service key) e confirma que está ASSINADA e ainda sem esses dados.
  const r = await sb(`contratos_link?token=eq.${encodeURIComponent(token)}&select=id,status,assinante_user_agent,assinante_geo`);
  const [c] = await r.json().catch(() => []);
  if (!c) return new Response(JSON.stringify({ error: 'Contrato não encontrado' }), { status: 404, headers });
  if (c.status !== 'assinado') return new Response(JSON.stringify({ error: 'O contrato ainda não foi assinado por esta parte.' }), { status: 409, headers });

  // Idempotente: só grava o que está FALTANDO (não sobrescreve captura legítima do momento da assinatura).
  const patch = {};
  if (!c.assinante_user_agent && userAgent) patch.assinante_user_agent = userAgent;
  if (!c.assinante_geo && geoOk) patch.assinante_geo = geoOk;
  if (!Object.keys(patch).length) return new Response(JSON.stringify({ ok: true, jaCompleto: true }), { status: 200, headers });
  patch.dados_complementados_em = new Date().toISOString();

  const up = await sb(`contratos_link?token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  });
  if (!up.ok) return new Response(JSON.stringify({ error: 'Falha ao complementar' }), { status: 500, headers });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
