export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

  // Valida autenticação — rejeita requisições sem token válido
  const authUser = await getAuthUser(req);
  if (!authUser?.id) return unauthorized();

  const { user_id, produto_tipo, produto_id, ref_codigo } = await req.json();

  if (!user_id || !produto_tipo || !produto_id) {
    return new Response(JSON.stringify({ error: 'Dados incompletos' }), { status: 400, headers });
  }

  // Garante que o usuário autenticado só pode registrar compra para si mesmo
  if (authUser.id !== user_id) {
    return new Response(JSON.stringify({ error: 'Ação não permitida' }), { status: 403, headers });
  }

  // Delega ao fluxo transacional ÚNICO (`comprar_produto_iniciar`), o mesmo que o checkout usa
  // em api/mp.js. Ele: (a) valida disponibilidade e lê o PREÇO do banco — o cliente não fixa
  // `valor`, então não dá para forjar; (b) checa duplicata/acesso-já-concedido; (c) resolve o
  // código do consultor e grava `ref_codigo` + `comissao_pct` na compra PENDENTE, para o webhook
  // (`confirmar_compra_produto`) pagar a comissão na ativação. A ativação nunca sai daqui.
  //
  // 21/08 (gap #4): antes, este endpoint fazia um insert manual e chamava
  // `rpc/vincular_indicacao_compra` — função que NUNCA existiu no banco. O PostgREST devolvia
  // 404 (PGRST202), o `catch (_) {}` engolia, e a indicação em compra de produto era perdida em
  // silêncio. Delegar ao avaliador único elimina a função fantasma e a duplicação do fluxo.
  const r = await sb('rpc/comprar_produto_iniciar', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: user_id, p_produto_tipo: produto_tipo, p_produto_id: produto_id, p_ref: ref_codigo || null }),
  });
  const out = await r.json().catch(() => null);
  if (!r.ok || !out || out.ok === false) {
    return new Response(JSON.stringify({ error: 'Não foi possível registrar a compra', motivo: out?.erro || null }), { status: 400, headers });
  }

  return new Response(JSON.stringify(out), { status: 200, headers });
}
