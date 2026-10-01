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
 * (economia). Logado, ou visitante com teto próprio por IP (checkout, 24/09). Se a chave não existir, devolve disabled=true (o front cai no
 * preenchimento manual, sem quebrar).
 */
export const config = { runtime: 'edge' };

import { getUser } from './_auth.js';
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
    // nome/tipos do LUGAR — quando é um condomínio/edifício/POI, `nome` traz o nome
    // do empreendimento (referência do índice ≤250m, como no mercadológico).
    nome: result?.name || '',
    tipos: Array.isArray(result?.types) ? result.types : [],
  };
}


// PLACES API (NEW) — motor primário desde 01/10. A "Places API" antiga (place/autocomplete/json)
// não pode mais ser ATIVADA em projeto novo do Google Cloud; a chave antiga ficou num projeto da
// conta pessoal cujo faturamento foi encerrado, e a org reimob.com.br (secure-by-default) não deixa
// vincular projeto de @gmail. A chave nova nasce num projeto da empresa — só com a API nova.
// A antiga segue como RESERVA abaixo: se a chave em uso só tiver a antiga, nada quebra.
// Erro aqui vem em HTTP não-2xx com `{ error: { status, message } }` — devolvido com o motivo.
async function novoAutocomplete(q, st) {
  const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY },
    body: JSON.stringify({ input: q, includedRegionCodes: ['br'], languageCode: 'pt-BR', ...(st ? { sessionToken: st } : {}) }),
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: d?.error?.status || `HTTP ${r.status}`, erro: String(d?.error?.message || '').slice(0, 160) };
  const sugestoes = (d.suggestions || []).map((x) => x.placePrediction).filter(Boolean).map((p) => ({
    id: p.placeId,
    texto: p.text?.text || '',
    principal: p.structuredFormat?.mainText?.text || p.text?.text || '',
    secundario: p.structuredFormat?.secondaryText?.text || '',
  })).filter((x) => x.id);
  return { ok: true, sugestoes };
}

async function novoDetalhe(placeId, st) {
  const u = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  u.searchParams.set('languageCode', 'pt-BR');
  if (st) u.searchParams.set('sessionToken', st);
  const r = await fetch(u.toString(), {
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'addressComponents,location,formattedAddress,displayName,types' },
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: d?.error?.status || `HTTP ${r.status}`, erro: String(d?.error?.message || '').slice(0, 160) };
  // Mesmo formato do legado para reaproveitar `comp()` — uma regra de extração só.
  const legado = {
    address_components: (d.addressComponents || []).map((c) => ({ long_name: c.longText, short_name: c.shortText, types: c.types || [] })),
    geometry: { location: { lat: d.location?.latitude ?? null, lng: d.location?.longitude ?? null } },
    formatted_address: d.formattedAddress || '',
    name: d.displayName?.text || '',
    types: d.types || [],
  };
  return { ok: true, endereco: comp(legado) };
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const headers = { 'Content-Type': 'application/json', ...cors };

  const rl = await checkRateLimit(`endereco-ac:${getIP(req)}`, 60, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  // VISITANTE também (24/09, pedido do dono): o checkout do Investidor Pro é preenchido ANTES de a
  // conta existir. Cada busca tem custo no Google — o visitante tem um teto próprio e mais
  // apertado por IP (logado segue só com o limite acima).
  const user = await getUser(req);
  if (!user) {
    const rlAnon = await checkRateLimit(`endereco-ac-anon:${getIP(req)}`, 30, 10 * 60_000);
    if (!rlAnon.ok) return rateLimitedResponse(rlAnon.resetAt);
  }

  if (!KEY) return new Response(JSON.stringify({ ok: true, disabled: true, sugestoes: [] }), { status: 200, headers });

  let body; try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const q = String(body.q || '').trim();
  const placeId = String(body.place_id || '').trim();
  const st = String(body.sessiontoken || '').trim();

  // API nova primeiro; a antiga só se a nova falhar (motivo das duas vai junto se ambas falharem).
  let falhaNova = null;
  try {
    const n = placeId ? await novoDetalhe(placeId, st) : (q.length >= 3 ? await novoAutocomplete(q, st) : { ok: true, sugestoes: [] });
    if (n.ok) return new Response(JSON.stringify(n), { status: 200, headers });
    falhaNova = `${n.status}${n.erro ? `: ${n.erro}` : ''}`;
    console.error('[endereco-autocomplete] Places (New) falhou — tentando a API antiga:', falhaNova);
  } catch (e) {
    falhaNova = `exceção: ${String(e?.message || e).slice(0, 120)}`;
    console.error('[endereco-autocomplete] Places (New) exceção — tentando a API antiga:', falhaNova);
  }

  try {
    if (placeId) {
      const u = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      u.searchParams.set('place_id', placeId);
      u.searchParams.set('fields', 'address_component,geometry,formatted_address,name,type');
      u.searchParams.set('language', 'pt-BR');
      if (st) u.searchParams.set('sessiontoken', st);
      u.searchParams.set('key', KEY);
      const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d.status !== 'OK') {
        console.error('[endereco-autocomplete] details', d.status, String(d.error_message || '').slice(0, 200));
        return new Response(JSON.stringify({ ok: false, status: d.status, erro: [String(d.error_message || '').slice(0, 160), falhaNova && `API nova: ${falhaNova}`].filter(Boolean).join(' | ') || undefined }), { status: 200, headers });
      }
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
      // `error_message` é o que diz POR QUE (API não ativada, faturamento, restrição da chave).
      console.error('[endereco-autocomplete] autocomplete', d.status, String(d.error_message || '').slice(0, 200));
      return new Response(JSON.stringify({ ok: false, status: d.status, erro: [String(d.error_message || '').slice(0, 160), falhaNova && `API nova: ${falhaNova}`].filter(Boolean).join(' | ') || undefined, sugestoes: [] }), { status: 200, headers });
    }
    const sugestoes = (d.predictions || []).map((p) => ({
      id: p.place_id,
      texto: p.description,
      principal: p.structured_formatting?.main_text || p.description,
      secundario: p.structured_formatting?.secondary_text || '',
    }));
    return new Response(JSON.stringify({ ok: true, sugestoes }), { status: 200, headers });
  } catch (e) {
    console.error('[endereco-autocomplete] exceção', String(e?.message || e));
    return new Response(JSON.stringify({ ok: false, erro: String(e?.message || e), sugestoes: [] }), { status: 200, headers });
  }
}
