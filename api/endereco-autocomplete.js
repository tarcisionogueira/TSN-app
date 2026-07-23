/**
 * POST /api/endereco-autocomplete — autocomplete de endereço estilo Google (o mesmo do
 * Plans & Billing do Anthropic). Proxy server-side para o Google Places: a chave
 * (GOOGLE_MAPS_API_KEY, já usada no geocoding) NUNCA vai ao cliente. Reusável em: consulta
 * do Índice, checkout/cobrança e cadastro/endereço do usuário.
 *
 * Body:
 *   { q: "alameda dourada 71", sessiontoken? }  → { sugestoes: [{ id, texto, principal, secundario }] }
 *   { place_id, sessiontoken? }                 → { endereco: { logradouro, numero, bairro, cidade, uf, cep, lat, lng, formatado } }
 *
 * sessiontoken agrupa as teclas + o detalhe numa ÚNICA sessão de cobrança do Google
 * (economia). Só logado. Se a chave não existir, devolve disabled=true (o front cai no
 * preenchimento manual, sem quebrar).
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const KEY = (process.env.GOOGLE_MAPS_API_KEY || '').trim();

function comp(result) {
  const c = result?.address_components || [];
  const get = (type) => c.find((x) => (x.types || []).includes(type));
  return {
    logradouro: get('route')?.long_name || '',
    numero: get('street_number')?.long_name || '',
    bairro: get('sublocality_level_1')?.long_name || get('sublocality')?.long_name || get('neighborhood')?.long_name || '',
    cidade: get('locality')?.long_name || get('administrative_area_level_2')?.long_name || '',
    uf: get('administrative_area_level_1')?.short_name || '',
    cep: get('postal_code')?.long_name || '',
    lat: result?.geometry?.location?.lat ?? null,
    lng: result?.geometry?.location?.lng ?? null,
    formatado: result?.formatted_address || '',
  };
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const headers = { 'Content-Type': 'application/json', ...cors };

  const rl = await checkRateLimit(`endereco-ac:${getIP(req)}`, 60, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  if (!KEY) return new Response(JSON.stringify({ ok: true, disabled: true, sugestoes: [] }), { status: 200, headers });

  let body; try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const q = String(body.q || '').trim();
  const placeId = String(body.place_id || '').trim();
  const st = String(body.sessiontoken || '').trim();

  try {
    if (placeId) {
      const u = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      u.searchParams.set('place_id', placeId);
      u.searchParams.set('fields', 'address_component,geometry,formatted_address');
      u.searchParams.set('language', 'pt-BR');
      if (st) u.searchParams.set('sessiontoken', st);
      u.searchParams.set('key', KEY);
      const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d.status !== 'OK') return new Response(JSON.stringify({ ok: false, status: d.status }), { status: 200, headers });
      return new Response(JSON.stringify({ ok: true, endereco: comp(d.result) }), { status: 200, headers });
    }
    if (q.length < 3) return new Response(JSON.stringify({ ok: true, sugestoes: [] }), { status: 200, headers });
    const u = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    u.searchParams.set('input', q);
    u.searchParams.set('components', 'country:br');
    u.searchParams.set('language', 'pt-BR');
    if (st) u.searchParams.set('sessiontoken', st);
    u.searchParams.set('key', KEY);
    const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d.status !== 'OK' && d.status !== 'ZERO_RESULTS') {
      return new Response(JSON.stringify({ ok: false, status: d.status, sugestoes: [] }), { status: 200, headers });
    }
    const sugestoes = (d.predictions || []).map((p) => ({
      id: p.place_id,
      texto: p.description,
      principal: p.structured_formatting?.main_text || p.description,
      secundario: p.structured_formatting?.secondary_text || '',
    }));
    return new Response(JSON.stringify({ ok: true, sugestoes }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String(e?.message || e), sugestoes: [] }), { status: 200, headers });
  }
}
