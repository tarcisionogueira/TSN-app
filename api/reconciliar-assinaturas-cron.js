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
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { ativarPlanoDireto, suspenderPlanoDireto } from './_webhook-core.js';
import { createClient } from '@supabase/supabase-js';

const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();

// IMPORTANTE: exportar por MÉTODO nomeado (GET/POST), não `export default`. No runtime
// Node da Vercel, `export default` é tratado como assinatura Express `(req, res)` e o
// `Response` retornado é IGNORADO — a função nunca sinaliza fim e trava até o maxDuration
// (504) a cada execução. Com GET/POST o `req` é um Request Web e o `Response` é honrado.
export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!MP_TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN ausente' }), { status: 500 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let verificados = 0, corrigidos = 0, rebaixados = 0;
  const mpGet = async (path) => {
    const r = await fetch(`https://api.mercadopago.com${path}`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
    return r.ok ? r.json() : null;
  };
  try {
    // ── UPGRADE: pagou (authorized) mas segue no Explorador → reativa. ─────────
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
        // Espelho local (financeiro): mantém mp_assinaturas em dia + backfilla o histórico.
        try {
          await supabase.from('mp_assinaturas').upsert({
            mp_assinatura_id: String(sub.id), user_id: userId, plano_key: planoKey,
            status: sub.status || null, dados_mp: sub, atualizado_em: new Date().toISOString(),
          }, { onConflict: 'mp_assinatura_id' });
        } catch { /* espelho — não bloqueia a reconciliação */ }
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

    // ── DOWNGRADE: cancelou/pausou E o período pago já terminou → rebaixa. ─────
    // Mantém o acesso até o fim do período pago (next_payment_date); só rebaixa
    // depois disso. Rede de segurança caso o webhook de cancelamento não chegue.
    const agora = new Date();
    for (const status of ['cancelled', 'paused']) {
      for (let offset = 0; offset < 3000; offset += 100) {
        const data = await mpGet(`/preapproval/search?status=${status}&offset=${offset}&limit=100`);
        const results = data?.results || [];
        if (!results.length) break;

        for (const sub of results) {
          const [userId, planoKey] = String(sub.external_reference || '').split('|');
          if (!userId || !planoKey) continue;
          // Espelho local (financeiro): reflete cancelamento/pausa em mp_assinaturas.
          try {
            await supabase.from('mp_assinaturas').upsert({
              mp_assinatura_id: String(sub.id), user_id: userId, plano_key: planoKey,
              status: sub.status || null, dados_mp: sub, atualizado_em: new Date().toISOString(),
            }, { onConflict: 'mp_assinatura_id' });
          } catch { /* espelho — não bloqueia */ }
          // Período pago ainda vigente → mantém acesso. Sem data confiável, não
          // rebaixa (conservador: o webhook é o caminho primário).
          const fim = sub.next_payment_date ? new Date(sub.next_payment_date) : null;
          if (!fim || fim > agora) continue;

          const { data: perfil } = await supabase.from('perfis').select('role').eq('id', userId).maybeSingle();
          if (!perfil || perfil.role === 'explorador') continue;

          // Não rebaixa quem tem assinatura ATIVA (re-assinou após cancelar).
          const ativo = await mpGet(`/preapproval/search?payer_email=${encodeURIComponent(sub.payer_email || '')}&status=authorized&limit=1`);
          if (ativo?.results?.length) continue;

          try { await suspenderPlanoDireto({ userId, gateway: 'mercadopago' }); rebaixados++; }
          catch (e) { console.error('[reconciliar] rebaixar', userId, e?.message); }
        }
        const total = Number(data?.paging?.total || 0);
        if (offset + 100 >= total) break;
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, verificados, corrigidos, rebaixados }), { headers: { 'Content-Type': 'application/json' } });
}
