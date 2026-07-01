/**
 * /api/reconciliar-assinaturas-cron — rede de segurança das assinaturas MP.
 *
 * Caso raro: o cliente paga (preapproval 'authorized' no MP), mas a ativação
 * direta E o webhook falham juntos → fica pagando e preso no Explorador.
 * Este cron varre os preapprovals AUTORIZADOS no MP e, se o usuário do
 * external_reference (userId|plano) ainda está como 'explorador' (e não é
 * inadimplência), reativa o plano. Idempotente.
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { ativarPlanoDireto } from './_webhook-core.js';
import { createClient } from '@supabase/supabase-js';

const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!MP_TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN ausente' }), { status: 500 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let verificados = 0, corrigidos = 0;
  try {
    for (let offset = 0; offset < 3000; offset += 100) {
      const r = await fetch(`https://api.mercadopago.com/preapproval/search?status=authorized&offset=${offset}&limit=100`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      if (!r.ok) break;
      const data = await r.json();
      const results = data?.results || [];
      if (!results.length) break;

      for (const sub of results) {
        const [userId, planoKey] = String(sub.external_reference || '').split('|');
        if (!userId || !planoKey) continue;
        verificados++;
        const { data: perfil } = await supabase.from('perfis').select('role, inadimplente_desde').eq('id', userId).maybeSingle();
        // Órfão: assinatura autorizada no MP, mas o cliente segue no Explorador
        // (e não é suspensão por inadimplência). Reativa o plano contratado.
        if (perfil && perfil.role === 'explorador' && !perfil.inadimplente_desde) {
          try { await ativarPlanoDireto({ userId, planoKey, gateway: 'mercadopago' }); corrigidos++; }
          catch (e) { console.error('[reconciliar] ativar', userId, e?.message); }
        }
      }
      const total = Number(data?.paging?.total || 0);
      if (offset + 100 >= total) break;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, verificados, corrigidos }), { headers: { 'Content-Type': 'application/json' } });
}
