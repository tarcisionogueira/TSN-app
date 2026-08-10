/**
 * POST /api/indice-gerar — GERA o Índice BidPro de uma localidade sob demanda (região ainda
 * não mapeada). Calcula venda/locação R$/m² da NOSSA base (mediana avaliação/m² do acervo no
 * nível mais específico com amostras) e SEMEIA cidade_indicadores — a mesma tabela que o
 * relatório mercadológico lê (indice_bidpro_regiao) → a geração alimenta o mercadológico.
 *
 * Cota (limite_ia 'indice'): admin ∞ · pago (top2/assessorado/clube) 3/mês · explorador 0 (só vê).
 * (Dizia 5/mês até 09/08; limite_ia devolve 3 — o 5 é só o grandfather do plano_legado.)
 * Só consome crédito quando GERA de verdade (região sem amostras não gasta cota).
 * Body: { cidade, uf, bairro?, lat?, lng?, tipo? }.
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function rpc(name, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json().catch(() => null) : null;
}

// Limite de IA: a falha da RPC NÃO pode virar "ilimitado". `rpc()` devolve null tanto para
// "sem limite" (admin/legado) quanto para "a chamada falhou" — e a linha abaixo lia null como
// ∞, então uma indisponibilidade do banco liberava a pesquisa web PAGA de graça, para qualquer
// papel. Aqui distinguimos os dois casos e falhamos FECHADO (503 "tente de novo"), nunca com a
// mensagem falsa de "sua cota acabou".
async function limiteIaOuFalha(name, body) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { erro: true };
    const v = await r.json().catch(() => undefined);
    if (v === undefined) return { erro: true };
    return { erro: false, valor: v };
  } catch { return { erro: true }; }
}
async function perfilDe(uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${uid}&select=role,indice_count,indice_mes`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const d = r.ok ? await r.json().catch(() => []) : [];
  return d[0] || null;
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const headers = { 'Content-Type': 'application/json', ...cors };

  const rl = await checkRateLimit(`indice-gerar:${getIP(req)}`, 10, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  let body; try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const cidadeNorm = norm(body.cidade);
  const uf = String(body.uf || '').trim().toUpperCase();
  const bairroNorm = norm(body.bairro);
  const SEGS = ['apartamento', 'casa', 'terreno', 'comercial'];
  const tipo = SEGS.includes(String(body.tipo || '').toLowerCase()) ? String(body.tipo).toLowerCase() : 'apartamento';
  const lat = Number.isFinite(+body.lat) ? +body.lat : null;
  const lng = Number.isFinite(+body.lng) ? +body.lng : null;
  if (!cidadeNorm || !/^[A-Z]{2}$/.test(uf)) return new Response(JSON.stringify({ error: 'Informe a cidade e a UF (2 letras).' }), { status: 400, headers });

  // Papel + cota (fonte única limite_ia).
  const perfil = await perfilDe(user.id);
  const role = perfil?.role || 'explorador';
  const lim = await limiteIaOuFalha('limite_ia_efetivo', { p_user_id: user.id, p_tipo: 'indice' }); // int | null (admin/legado 5)
  // Este handler é EDGE (devolve Response); o `res.status().json()` daqui era do runtime Node e
  // não existe neste escopo — o caminho de erro do limite estourava ReferenceError em vez de
  // devolver 503. Achado de lint em 06/08, pré-existente.
  if (lim.erro) return new Response(JSON.stringify({ error: 'Não foi possível confirmar seu limite agora. Tente de novo em instantes.', motivo: 'limite_indisponivel' }), { status: 503, headers });
  const limite = lim.valor;
  const ilimitado = limite === null;
  const mesAtual = new Date().toISOString().slice(0, 7);
  const usadas = (perfil?.indice_mes === mesAtual) ? (perfil?.indice_count || 0) : 0;

  if (!ilimitado && (limite || 0) <= 0)
    return new Response(JSON.stringify({ error: 'Gerar o índice de uma região nova é um recurso dos planos pagos.', motivo: 'sem_indice' }), { status: 403, headers });
  if (!ilimitado && usadas >= limite)
    return new Response(JSON.stringify({ error: `Você já usou suas ${limite} gerações de índice deste mês.`, motivo: 'limite_mensal', usadas, limite }), { status: 402, headers });

  // Fonte PRIMÁRIA: AMOSTRAS DE MERCADO (indice_amostras — pesquisa web + backfill histórico),
  // ponderadas por recência do anúncio. Fallback: mediana do ACERVO (gerar_indice_regiao) quando
  // a região ainda não tem amostras de mercado. Sem nenhuma das duas → NÃO consome crédito.
  const pond = await rpc('indice_regiao_ponderado', { p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
  let out = null;
  if (pond && pond.venda_m2 != null) {
    out = {
      fonte: 'mercado', nivel: pond.nivel, venda_m2: pond.venda_m2,
      // Só aluguel MEDIDO (regra do dono, 06/08). A regra de bolso de 0,4%/mês entrava aqui e
      // era SEMEADA em cidade_indicadores — o número inventado virava "base própria" e voltava
      // depois como se fosse mercado observado, inclusive em terreno, que não se aluga.
      aluguel_m2: pond.locacao_m2 != null ? pond.locacao_m2 : null,
      n_amostras: (pond.n_venda || 0) + (pond.n_locacao || 0),
    };
  } else {
    const g = await rpc('gerar_indice_regiao', { p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
    if (g && g.gerado === true) out = { fonte: 'acervo', nivel: g.nivel, venda_m2: g.venda_m2, aluguel_m2: g.aluguel_m2, n_amostras: g.n_amostras };
  }
  if (!out)
    return new Response(JSON.stringify({ ok: true, gerado: false, motivo: 'sem_amostras' }), { status: 200, headers });

  // Consome 1 crédito só quando ENTREGOU um índice (admin/legado ∞ não consome).
  let cota = { ilimitado: true };
  if (!ilimitado) cota = (await rpc('consumir_indice_por', { p_user_id: user.id })) || {};

  return new Response(JSON.stringify({ ok: true, gerado: true, cota, ...out }), { status: 200, headers });
}
