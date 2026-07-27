/**
 * POST /api/matricula-certidao
 * Resolve a "matrícula de leitura" (certidão de matrícula oficial) de um imóvel —
 * usada tanto na ANÁLISE documental quanto no dossiê de REGISTRO pós-arrematação.
 *
 * Entrada (JSON): { uf, cidade, matricula? }   (ou { estado } como alias de uf)
 * Saída: {
 *   cartorios: [{id,nome,cidade,uf}],   // CRI(s) resolvidos pela central ONR
 *   integrado: bool|null,               // cidade integrada ao RI Digital?
 *   fonte: 'auto' | 'guiado',           // como a certidão será obtida
 *   auto?: {...},                       // presente só quando o pull automático rodar
 *   pedido: {...}                       // passo a passo guiado (sempre presente)
 * }
 *
 * Estratégia: tenta o pull AUTOMÁTICO (atrás de flag, só quando a sonda confirmar
 * a capacidade da conta ONR); caso contrário devolve o PEDIDO GUIADO — o investidor
 * gera a certidão dele no portal oficial em poucos cliques. Não cobra nada aqui:
 * o custo (R$ 68,20 + ISS) é pago direto ao ONR no ato do pedido.
 */

import { getAuthUser } from './_auth.js';
import { resolverCartorio, montarPedidoGuiado, tentarCertidaoAuto, ONR_LINKS, CERTIDAO_CUSTO, CERTIDAO_PRAZO } from './_onr-certidao.js';

export const config = { runtime: 'edge' };

const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405, headers: H });
  }

  const user = await getAuthUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: H });

  let body = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }

  const uf = String(body.uf || body.estado || '').trim().toUpperCase();
  const cidade = String(body.cidade || '').trim();
  const matricula = body.matricula ? String(body.matricula).trim() : null;

  if (!uf) {
    return new Response(JSON.stringify({ error: 'Informe ao menos a UF (uf) do imóvel.' }), { status: 400, headers: H });
  }

  // 1. Resolve o cartório (CRI) da cidade na central ONR (best-effort).
  const { integrado, cartorios, total_uf, erro } = await resolverCartorio(uf, cidade);
  const cartorioPrincipal = cartorios?.[0] || null;

  // 2. Tenta o pull automático (só roda com ONR_CERTIDAO_AUTO='1' e capacidade confirmada).
  const auto = await tentarCertidaoAuto({ uf, cidade, matricula, cartorio: cartorioPrincipal });

  // 3. Pedido guiado — sempre disponível, é o fallback que "direciona o passo a passo".
  const pedido = montarPedidoGuiado({ uf, cidade, matricula, cartorio: cartorioPrincipal });

  return new Response(JSON.stringify({
    integrado,
    cartorios: cartorios || [],
    total_uf: total_uf ?? null,
    consulta_onr: erro ? 'indisponivel' : 'ok',
    fonte: auto?.disponivel ? 'auto' : 'guiado',
    auto: auto?.disponivel ? auto : { disponivel: false, motivo: auto?.motivo || 'guiado' },
    pedido,
    links: ONR_LINKS,
    custo: CERTIDAO_CUSTO,
    prazo: CERTIDAO_PRAZO,
  }), { status: 200, headers: H });
}
