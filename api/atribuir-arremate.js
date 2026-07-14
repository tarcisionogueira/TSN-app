/**
 * POST /api/atribuir-arremate — admin/analista ATRIBUI uma arrematação a um usuário
 * (ex.: cliente novo que já tem operação em andamento). Cria um CASO marcado como
 * "arrematado" (habilita o acompanhamento + lançamentos financeiros/indicadores) e
 * promove o usuário para ASSESSORADO imediatamente.
 *
 * Body: { user_id, imovel_endereco?, imovel_valor?, tipo_leilao? }
 * Só admin/analista. Usa service key (age em nome de outro usuário — fora do RLS).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, getUserRoleById } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return json({ error: 'Apenas admin/analista podem atribuir arremates.' }, 403);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase não configurado' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const { user_id, imovel_endereco, imovel_valor, tipo_leilao } = body || {};
  if (!user_id) return json({ error: 'user_id obrigatório' }, 400);

  // Valida o usuário-alvo.
  const [alvo] = await (await sb(`perfis?id=eq.${encodeURIComponent(user_id)}&select=id,role&limit=1`)).json().catch(() => []);
  if (!alvo) return json({ error: 'Usuário não encontrado' }, 404);

  // 1) Cria o CASO já marcado como arrematado (habilita o acompanhamento/lançamentos).
  const agora = new Date();
  const valor = Number(String(imovel_valor ?? '').toString().replace(/\./g, '').replace(',', '.')) || null;
  const casoRow = {
    cliente_id: user_id,
    imovel_id: null,
    imovel_endereco: imovel_endereco || 'Operação atribuída pela equipe',
    imovel_valor: valor,
    status_etapa: 'arrematado',
    arrematado_em: agora.toISOString(),
    tipo_leilao: /judicial/i.test(tipo_leilao || '') ? 'judicial' : 'extrajudicial',
    analista_id: role === 'analista' ? user.id : null,
  };
  const casoRes = await sb('casos', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(casoRow) });
  if (!casoRes.ok) return json({ error: 'Falha ao criar o caso', detalhe: await casoRes.text().catch(() => '') }, 500);
  const [caso] = await casoRes.json().catch(() => []);

  // 2) Promove o usuário para ASSESSORADO imediatamente (habilita as telas/indicadores).
  //    Atribuição pela equipe NÃO gera cobrança — a validade da assessoria é de 12
  //    meses (até a conclusão da posse), então marcamos plano_vencimento = hoje+12m.
  const venc = new Date(agora); venc.setMonth(venc.getMonth() + 12);
  const upd = await sb(`perfis?id=eq.${encodeURIComponent(user_id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ role: 'assessorado', plano_vencimento: venc.toISOString() }),
  });
  if (!upd.ok) return json({ error: 'Caso criado, mas falha ao promover para assessorado', detalhe: await upd.text().catch(() => ''), caso_id: caso?.id }, 500);

  return json({ ok: true, caso_id: caso?.id, role: 'assessorado', plano_vencimento: venc.toISOString() });
}
