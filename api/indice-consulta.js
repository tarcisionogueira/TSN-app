/**
 * POST /api/indice-consulta — consulta do Índice BidPro (só LEITURA do que já está mapeado).
 * Grátis para qualquer usuário logado (Explorador incluso): não roda IA, só lê a base.
 * Body: { cidade, uf, bairro? }. Retorna venda/locação R$/m², nível, nº de amostras e a
 * valorização por ano (venda). Se a região não está mapeada, mapeado=false (a GERAÇÃO para
 * regiões não mapeadas é recurso dos planos pagos — feita por outro endpoint, com quota).
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
// Mesma normalização do banco (_bairro_norm): minúsculas, sem acento, só alfanumérico.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function rpc(name, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json().catch(() => null) : null;
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const headers = { 'Content-Type': 'application/json', ...cors };

  const rl = await checkRateLimit(`indice-consulta:${getIP(req)}`, 30, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  let body; try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const cidadeNorm = norm(body.cidade);
  const uf = String(body.uf || '').trim().toUpperCase();
  const bairroNorm = norm(body.bairro);
  if (!cidadeNorm || !/^[A-Z]{2}$/.test(uf)) {
    return new Response(JSON.stringify({ error: 'Informe a cidade e a UF (2 letras).' }), { status: 400, headers });
  }

  try {
    const regiao = await rpc('indice_bidpro_regiao', {
      p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro: bairroNorm, p_lat: null, p_lng: null, p_tipo: 'residencial',
    });
    const valorizacao = await rpc('indice_valorizacao_anual', {
      p_cidade_norm: cidadeNorm, p_uf: uf, p_tipo: 'residencial', p_bairro_norm: bairroNorm, p_especie: 'venda', p_anos: 6,
    });
    const mapeado = !!(regiao && (Number(regiao.venda_m2) > 0 || Number(regiao.aluguel_m2) > 0));
    return new Response(JSON.stringify({ ok: true, mapeado, regiao: mapeado ? regiao : null, valorizacao: valorizacao || null }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Falha na consulta' }), { status: 500, headers });
  }
}
