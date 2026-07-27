/**
 * /api/backfill-mp-pagamentos-cron — espelha os pagamentos do Mercado Pago em `mp_pagamentos`
 * (financeiro). O webhook já grava going-forward; este cron backfilla o histórico e cobre
 * eventuais perdas de webhook. Idempotente (upsert por mp_payment_id).
 *
 * Classificação: origem='recorrente' quando operation_type='recurring_payment' (mensalidade),
 * senão 'avulso' (venda: serviço/produto/compra pontual). Ignora money_transfer / saques /
 * aportes (não são receita de cliente).
 *
 * Roda 1x/semana (vercel.json). Leve. Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
const MAX_OFFSET = 5000; // teto de segurança de custo/tempo (50 páginas)

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!MP_TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN ausente' }), { status: 500 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let vistos = 0, gravados = 0, truncado = false;
  try {
    for (let offset = 0; offset <= MAX_OFFSET; offset += 100) {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=100&offset=${offset}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      if (!r.ok) break;
      const data = await r.json();
      const results = data?.results || [];
      if (!results.length) break;

      for (const p of results) {
        vistos++;
        // Só receita de cliente: pagamento comum ou cobrança recorrente.
        const op = p.operation_type;
        if (op && op !== 'regular_payment' && op !== 'recurring_payment') continue;
        const ext = String(p.external_reference || '').trim();
        const [refUser, refPlano] = ext.includes('|') ? ext.split('|') : [];
        const { error } = await supabase.from('mp_pagamentos').upsert({
          mp_payment_id: String(p.id),
          user_id: refUser || p.metadata?.user_id || p.metadata?.userId || null,
          plano_key: refPlano || p.metadata?.planoKey || null,
          valor: p.transaction_amount ?? null,
          status: p.status || null,
          status_detalhe: p.status_detail || null,
          metodo: p.payment_method_id || null,
          external_ref: ext || null,
          origem: op === 'recurring_payment' ? 'recorrente' : 'avulso',
          dados_mp: p,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'mp_payment_id' });
        if (!error) gravados++;
      }

      const total = Number(data?.paging?.total || 0);
      if (offset + 100 >= total) break;
      if (offset + 100 > MAX_OFFSET) { truncado = total > MAX_OFFSET; break; }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  if (truncado) console.warn(`[backfill-mp-pagamentos] teto ${MAX_OFFSET} atingido — histórico mais antigo não varrido nesta execução.`);
  return new Response(JSON.stringify({ ok: true, vistos, gravados, truncado }), { headers: { 'Content-Type': 'application/json' } });
}
