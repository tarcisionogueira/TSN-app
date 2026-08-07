/**
 * POST /api/sinalizar-arremate
 * O cliente sinaliza "Arrematei este imóvel". Efeitos (Retenção Etapa 2):
 *   1. Cria/garante um registro em `arrematados` (aparece em "Meus Arrematados").
 *   2. Marca os documentos do imóvel como arrematados (imovel_anexos.arrematado=true)
 *      → a retenção passa a MANTER os documentos (Regra 1: enquanto o dono paga).
 *   3. Cancela qualquer aviso de retenção pendente (Regra 2) daquele imóvel — o
 *      cliente sinalizou a tempo, então nada será apagado.
 *
 * Autoconsentido: o usuário declara o próprio arremate. Não há escalação — só
 * cria linha para si e PROTEGE documentos (nunca apaga).
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const headers = { 'Content-Type': 'application/json', ...cors };

  const ip = getIP(req);
  const rl = await checkRateLimit(`sinalizar-arremate:${ip}`, 20, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }

  const imovelId = String(body.imovel_id || '').trim();
  if (!imovelId) return new Response(JSON.stringify({ error: 'imovel_id obrigatório' }), { status: 400, headers });

  const titulo = (body.titulo ? String(body.titulo) : '').slice(0, 300) || null;
  const cidade = (body.cidade ? String(body.cidade) : '').slice(0, 120) || null;
  const estado = (body.estado ? String(body.estado) : '').slice(0, 60) || null;
  // Valor do arremate é OBRIGATÓRIO (registro do negócio + calibra teto de lance).
  // NÃO alimenta o Índice BidPro — arremate é operação extraordinária, não preço de
  // mercado convencional (só a REVENDA vira amostra de mercado).
  const valor  = Number(body.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return new Response(JSON.stringify({ error: 'Informe por quanto você arrematou (valor do arremate).' }), { status: 400, headers });
  }

  try {
    // 1) Já existe um "arrematado" deste usuário para este imóvel? (evita duplicar)
    const exRes = await sb(`arrematados?select=id&user_id=eq.${user.id}&imovel_id=eq.${encodeURIComponent(imovelId)}&limit=1`);
    const ex = await exRes.json().catch(() => []);
    if (!Array.isArray(ex) || !ex.length) {
      const ins = await sb('arrematados', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: user.id,
          imovel_id: imovelId,
          titulo, cidade, estado,
          status: 'em_processo',
          valor_arrematacao: valor,
          data_arrematacao: new Date().toISOString().slice(0, 10),
        }),
      });
      // FALHA-ALTO (07/08): a resposta do insert não era checada e o handler devolvia
      // ok:true de qualquer jeito — o botão virava "Arremate confirmado ✓" sem existir linha
      // em `arrematados`. Pior que a mensagem errada: é esse registro que PROTEGE os
      // documentos do lote da limpeza por retenção, então o cliente ficava achando que
      // estava tudo guardado enquanto o prazo corria.
      if (!ins.ok) {
        const corpo = await ins.text().catch(() => '');
        console.error('[sinalizar-arremate] insert falhou', ins.status, String(corpo).slice(0, 300));
        return new Response(JSON.stringify({ error: 'Não foi possível registrar o arremate agora. Tente novamente em instantes.' }), { status: 502, headers });
      }
    }

    // 2/3) Só quando o imovel_id é um UUID real (imóvel do acervo): protege os
    //      documentos e cancela avisos de retenção pendentes daquele imóvel.
    if (UUID_RE.test(imovelId)) {
      await sb(`imovel_anexos?imovel_id=eq.${imovelId}&arrematado=eq.false`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ arrematado: true }),
      });
      await sb(`doc_retencao_aviso?imovel_id=eq.${imovelId}&regra=eq.r2_sem_arremate&cancelado_em=is.null`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ cancelado_em: new Date().toISOString() }),
      });
    }

    // Log de atividade (Cliente 360) — best-effort.
    try {
      await sb('rpc/registrar_atividade', { method: 'POST', body: JSON.stringify({
        p_user_id: user.id, p_evento: 'arremate',
        p_detalhe: `Arremate sinalizado${Number.isFinite(valor) ? ` — R$ ${Math.round(valor).toLocaleString('pt-BR')}` : ''}${body.titulo ? ` · ${String(body.titulo).slice(0, 80)}` : ''}`,
        p_meta: { imovel_id: imovelId, valor } }) });
    } catch { /* log best-effort */ }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Falha ao sinalizar arremate' }), { status: 500, headers });
  }
}
