/**
 * POST /api/sinalizar-revenda
 * O cliente registra por quanto REVENDEU um imóvel arrematado. A revenda é transação
 * REAL de mercado → (1) grava em arrematados (revenda_valor/data/m²) como gabarito para
 * calibrar a precisão das estimativas e (2) vira AMOSTRA do Índice BidPro (com a data),
 * do MESMO jeito que um anúncio de portal. O preço do ARREMATE nunca entra no Índice.
 *
 * Body: { arrematado_id?, imovel_id?, valor, data_mes ("AAAA-MM"), area_m2? }
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Normalização igual à _bairro_norm do banco (minúsculas, sem acento, só alfanumérico).
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const headers = { 'Content-Type': 'application/json', ...cors };

  const rl = await checkRateLimit(`sinalizar-revenda:${getIP(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }

  const valor = Number(body.valor);
  if (!Number.isFinite(valor) || valor <= 0) return new Response(JSON.stringify({ error: 'Informe o valor da revenda.' }), { status: 400, headers });
  const mes = /^\d{4}-\d{2}$/.test(String(body.data_mes || '')) ? String(body.data_mes) : new Date().toISOString().slice(0, 7);
  const dataRef = `${mes}-01`;
  const imovelId = String(body.imovel_id || '').trim();
  const arrematadoId = String(body.arrematado_id || '').trim();

  try {
    // Localiza o arrematado do usuário (por id, ou por imovel). Garante posse.
    const filtro = arrematadoId ? `id=eq.${encodeURIComponent(arrematadoId)}`
      : `imovel_id=eq.${encodeURIComponent(imovelId)}`;
    const arrRes = await sb(`arrematados?select=id,imovel_id,cidade,estado&user_id=eq.${user.id}&${filtro}&limit=1`);
    const arrRows = await arrRes.json().catch(() => []);
    const arr = Array.isArray(arrRows) && arrRows.length ? arrRows[0] : null;
    if (!arr) return new Response(JSON.stringify({ error: 'Arremate não encontrado para este usuário.' }), { status: 404, headers });

    const iid = imovelId || String(arr.imovel_id || '');

    // Resolve cidade/UF/área do imóvel (para R$/m² e a chave do Índice).
    let cidadeNorm = norm(arr.cidade), uf = String(arr.estado || '').toUpperCase(), area = Number(body.area_m2) || null;
    if (UUID_RE.test(iid)) {
      const ilRes = await sb(`imoveis_leilao?id=eq.${iid}&select=cidade_norm,estado,area_m2&limit=1`);
      const il = (await ilRes.json().catch(() => []))?.[0];
      if (il) {
        if (il.cidade_norm) cidadeNorm = il.cidade_norm;
        if (il.estado) uf = String(il.estado).toUpperCase();
        if (!area && Number(il.area_m2) > 0) area = Number(il.area_m2);
      }
    }
    const valorM2 = area > 0 ? Math.round(valor / area) : null;

    // 1) Gabarito na tabela do arremate.
    await sb(`arrematados?id=eq.${arr.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revenda_valor: valor, revenda_data: dataRef, revenda_m2: area || null }),
    });

    // 2) Amostra REAL de mercado no Índice (só se der para calcular R$/m² plausível).
    let amostra = false;
    if (cidadeNorm && uf && valorM2 && valorM2 >= 200 && valorM2 <= 50000) {
      await sb('indice_amostra', {
        method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify({
          cidade_norm: cidadeNorm, uf, bairro_norm: '', geo_grid: '', tipo: 'residencial',
          especie: 'venda', valor_m2: valorM2, valor_total: valor, area_m2: area,
          data_ref: dataRef, fonte: 'Revenda (cliente)', origem: 'revenda', imovel_id: iid,
        }),
      });
      amostra = true;
    }

    // Log de atividade (Cliente 360) — best-effort, mesmo padrão do sinalizar-arremate.
    // Antes a revenda NÃO era logada (o Cliente 360 tinha o rótulo "Revenda sinalizada" mas
    // nenhum escritor) → sumia da linha do tempo do usuário.
    try {
      await sb('rpc/registrar_atividade', { method: 'POST', body: JSON.stringify({
        p_user_id: user.id, p_evento: 'revenda',
        p_detalhe: `Revenda registrada — R$ ${Math.round(valor).toLocaleString('pt-BR')}${valorM2 ? ` (R$ ${valorM2.toLocaleString('pt-BR')}/m²)` : ''}`,
        p_meta: { imovel_id: iid, valor, valor_m2: valorM2, amostra } }) });
    } catch { /* log best-effort */ }

    return new Response(JSON.stringify({ ok: true, valor_m2: valorM2, area, amostra }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Falha ao registrar revenda' }), { status: 500, headers });
  }
}
