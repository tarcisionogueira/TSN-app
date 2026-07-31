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

// Pro ANUAL avulso (sem recorrência): âncora no perfil (plano_ciclo='anual' + plano_pago_em
// dentro de ~13 meses cobrindo a folga da renovação). Evita rebaixar quem pagou o anual.
function proAnualVigente(perfil) {
  if (!/anual/i.test(perfil?.plano_ciclo || '') || !perfil?.plano_pago_em) return false;
  const pago = new Date(perfil.plano_pago_em).getTime();
  return Number.isFinite(pago) && (Date.now() - pago) < 13 * 30 * 24 * 3600 * 1000;
}
// Assinatura ativa no Asaas (outro gateway) — quem cancelou no MP e re-assinou no Asaas.
async function temAssinaturaAsaasAtiva(asaasId) {
  const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();
  if (!asaasId || !ASAAS_KEY) return false;
  try {
    const url = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
    const r = await fetch(`${url}/subscriptions?customer=${encodeURIComponent(asaasId)}&status=ACTIVE&limit=1`, { headers: { access_token: ASAAS_KEY } });
    if (!r.ok) return false;
    const d = await r.json().catch(() => null);
    return (d?.data || []).length > 0;
  } catch { return false; }
}

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
          // ASSESSORIA é recorrência FINITA (12×): o preapproval terminar/cancelar é o
          // fim NORMAL do parcelamento, não perda de plano — o encerramento da assessoria
          // é pelo fluxo de POSSE (marcar-posse), nunca pelo gateway (regra do dono 30/07).
          if (/^assessorado/.test(planoKey)) continue;
          // Período pago ainda vigente → mantém acesso. Sem data confiável, não
          // rebaixa (conservador: o webhook é o caminho primário).
          const fim = sub.next_payment_date ? new Date(sub.next_payment_date) : null;
          if (!fim || fim > agora) continue;

          const { data: perfil } = await supabase.from('perfis').select('role, asaas_id, plano_ciclo, plano_pago_em').eq('id', userId).maybeSingle();
          if (!perfil || perfil.role === 'explorador') continue;
          // Anti-flip: não rebaixa quem está num degrau MAIOR que o plano desta
          // assinatura (ex.: virou assessorado/clube e o preapproval antigo do Pro
          // foi cancelado — o plano vigente não depende mais dele).
          const RANK = { explorador: 0, top2: 1, top2_anual: 1, assessorado: 2, assessorado_anual: 2, clube: 3, clube_anual: 3 };
          if ((RANK[perfil.role] ?? 99) > (RANK[planoKey] ?? 0)) continue;

          // Não rebaixa quem tem assinatura ATIVA no MP (re-assinou após cancelar)...
          const ativo = await mpGet(`/preapproval/search?payer_email=${encodeURIComponent(sub.payer_email || '')}&status=authorized&limit=1`);
          if (ativo?.results?.length) continue;
          // ...NEM quem tem o plano vivo por OUTRA via (bug bounty #9): re-assinou no Asaas
          // ou pagou o Pro ANUAL avulso (sem recorrência). Sem isto, o cron rebaixava todo
          // dia e a mensalidade Asaas/o anual "recuperava" — flip-flop com dias sem acesso.
          if (proAnualVigente(perfil) || await temAssinaturaAsaasAtiva(perfil.asaas_id)) continue;

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
