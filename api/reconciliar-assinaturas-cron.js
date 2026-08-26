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

// Pro ANUAL vigente: âncora no perfil por plano_vencimento — REANCORADO a cada renovação
// (ativarPlanoDireto/processarConfirmado). Medir por plano_pago_em quebrava no ano 2 do
// recorrente (a janela de 13m expirava com o mandato ativo → rebaixava quem paga — P1.1).
function proAnualVigente(perfil) {
  if (!/anual/i.test(perfil?.plano_ciclo || '') || !perfil?.plano_vencimento) return false;
  const venc = new Date(perfil.plano_vencimento).getTime();
  return Number.isFinite(venc) && venc > Date.now();
}
// Assinatura ativa no Asaas (outro gateway) — quem cancelou no MP e re-assinou no Asaas.
async function temAssinaturaAsaasAtiva(asaasId) {
  const c = await checarAsaasAtivo(asaasId);
  return c.ativo; // compat (usado no loop de DOWNGRADE, onde false-on-erro é conservador o bastante)
}
// Versão TRI-ESTADO para o loop de rebaixamento anual (B3): distingue "ativo" de
// "erro de consulta" — um 5xx/timeout NÃO pode ser lido como "sem assinatura" e derrubar
// quem paga. { ativo, erro }.
async function checarAsaasAtivo(asaasId) {
  const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();
  if (!asaasId || !ASAAS_KEY) return { ativo: false, erro: false };
  try {
    const url = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
    const r = await fetch(`${url}/subscriptions?customer=${encodeURIComponent(asaasId)}&status=ACTIVE&limit=1`, { headers: { access_token: ASAAS_KEY } });
    if (!r.ok) return { ativo: false, erro: true };          // consulta falhou → INCERTO
    const d = await r.json().catch(() => null);
    if (d == null) return { ativo: false, erro: true };
    return { ativo: (d?.data || []).length > 0, erro: false };
  } catch { return { ativo: false, erro: true }; }
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
          // BLINDAGEM (P0.4): NÃO re-conceder plano a quem exerceu a garantia de 7 dias. O
          // cancelamento MP na garantia é best-effort; se o PUT falhou, o preapproval segue
          // authorized e este loop re-concederia o plano REEMBOLSADO. Pula se há reembolso.
          const { data: garantia } = await supabase.from('reembolsos_garantia').select('id').eq('user_id', userId).limit(1).maybeSingle();
          if (garantia) continue;
          // MANDATO AUTORIZADO NÃO É PAGAMENTO (16/08). O laço acima varre
          // `preapproval/search?status=authorized`, que devolve todo mandato que o MP tem
          // permissão de cobrar — inclusive o de quem NUNCA pagou. Concedendo o plano só
          // por estar nessa lista, este cron reproduzia em rotina o mesmo defeito que hoje
          // foi corrigido nas seis portas do checkout: bastava o cartão ser válido.
          // Agora exige a fatura: `/authorized_payments` é o histórico de cobranças DESTE
          // mandato; sem uma processada/aprovada, não há o que reativar. Quando há, ela vai
          // como `cobranca` — o que também restaura a recuperação legítima de quem pagou e
          // perdeu o webhook, caso que a guarda de `ativarPlanoDireto` sozinha barraria.
          const pagos = await mpGet(`/authorized_payments/search?preapproval_id=${encodeURIComponent(sub.id)}&limit=20`);
          if (pagos === null) { console.error('[reconciliar] histórico de cobranças indisponível para', sub.id, '— não ativa às cegas'); continue; }
          const cobrado = (pagos?.results || []).find(p =>
            (p?.status === 'processed' || p?.payment?.status === 'approved') && Number(p?.transaction_amount) > 0);
          if (!cobrado) continue;
          try {
            await ativarPlanoDireto({ userId, planoKey, gateway: 'mercadopago',
              cobranca: { gatewayPaymentId: String(cobrado.payment?.id || cobrado.id), valor: cobrado.transaction_amount } });
            corrigidos++;
          }
          catch (e) { console.error('[reconciliar] ativar', userId, e?.message); }
        }
      }
      const total = Number(data?.paging?.total || 0);
      if (offset + 100 >= total) break;
    }

    // ── PAGOU E NÃO TEM ACESSO: pagamento AVULSO de plano (regra do dono, 05/08) ──
    // A varredura acima cobre PREAPPROVAL (assinatura recorrente). O Pro ANUAL via PIX é
    // pagamento AVULSO com metadata.proposito='plano_anual' — ficava FORA de qualquer
    // reconciliação: se a ativação no webhook falhasse, o cliente pagava R$449,90 e nada
    // nem ninguém corrigia. O bug de idempotência que causava isso foi corrigido em
    // mp-webhook (as duas marcas caem no erro), mas a regra do dono é categórica: "se o
    // cliente pagou, deve ter acesso". Esta passagem é a rede que não depende do webhook.
    // Idempotente: ativarPlanoDireto não re-concede o que já está ativo, e a escada
    // anti-rebaixamento impede que um anual antigo derrube um tier maior atual.
    try {
      const { data: pagosAvulsos } = await supabase
        .from('mp_pagamentos')
        .select('mp_payment_id, valor, dados_mp, criado_em')
        .eq('status', 'approved')
        .order('criado_em', { ascending: false })
        .limit(300);
      for (const pg of (pagosAvulsos || [])) {
        const meta = pg?.dados_mp?.metadata || {};
        if (meta.proposito !== 'plano_anual') continue;
        const uid = meta.user_id;
        if (!uid) continue;
        verificados++;
        const { data: perfil } = await supabase.from('perfis')
          .select('role, plano_ciclo, plano_vencimento, inadimplente_desde').eq('id', uid).maybeSingle();
        if (!perfil || perfil.inadimplente_desde) continue;
        if (proAnualVigente(perfil)) continue;                 // já tem o anual vigente
        if (['assessorado', 'clube'].includes(perfil.role)) continue; // tier MAIOR: não mexe
        // Garantia de 7 dias exercida → não re-conceder o que foi reembolsado (mesma
        // blindagem P0.4 do laço de preapproval).
        const { data: garantia } = await supabase.from('reembolsos_garantia').select('id').eq('user_id', uid).limit(1).maybeSingle();
        if (garantia) continue;
        try {
          await ativarPlanoDireto({ userId: uid, planoKey: 'top2_anual', gateway: 'mercadopago',
            cobranca: { gatewayPaymentId: String(pg.mp_payment_id), valor: Number(pg.valor) || 0 } });
          corrigidos++;
          console.log('[reconciliar] plano anual pago e sem acesso → ativado', uid, pg.mp_payment_id);
        } catch (e) { console.error('[reconciliar] anual avulso', uid, e?.message); }
      }
    } catch (e) { console.error('[reconciliar] varredura avulsos:', e?.message); }

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

          const { data: perfil } = await supabase.from('perfis').select('role, asaas_id, plano_ciclo, plano_pago_em, plano_vencimento').eq('id', userId).maybeSingle();
          if (!perfil || perfil.role === 'explorador') continue;
          // Anti-flip: não rebaixa quem está num degrau MAIOR que o plano desta
          // assinatura (ex.: virou assessorado/clube e o preapproval antigo do Pro
          // foi cancelado — o plano vigente não depende mais dele).
          const RANK = { explorador: 0, top2: 1, top2_anual: 1, assessorado: 2, assessorado_anual: 2, clube: 3, clube_anual: 3 };
          if ((RANK[perfil.role] ?? 99) > (RANK[planoKey] ?? 0)) continue;

          // Não rebaixa quem tem assinatura ATIVA no MP (re-assinou após cancelar).
          // Busca por `payer_id` — `/preapproval/search` NÃO devolve `payer_email` (achado
          // 04/08: a chave nem existe no payload). Com `payer_email=` vazio o filtro era
          // ignorado pelo MP e a busca voltava QUALQUER assinatura autorizada da conta →
          // este `continue` disparava sempre e a rede de rebaixamento nunca agia. Sem
          // `payer_id` (não deveria acontecer) preferimos o conservador: não rebaixa.
          const payerId = sub.payer_id || sub.payer?.id;
          if (!payerId) continue;
          const ativo = await mpGet(`/preapproval/search?payer_id=${encodeURIComponent(payerId)}&status=authorized&limit=1`);
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

    // ── ANUAL VENCIDO (regra b materializada + fim do anual/legado) ───────────
    // A âncora anual expirou. Se o cliente re-assinou (mandato ativo em qualquer gateway),
    // o webhook já regravou ciclo/vencimento → nada a fazer. Sem mandato ativo → o anual
    // terminou (agendou mensal e não reautorizou, cancelou, ou legado avulso vencido):
    // rebaixa a explorador e limpa a âncora. GRAÇA de 5 dias evita rebaixar um recorrente
    // cuja renovação está sendo processada perto do vencimento.
    const grace = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    // 'cortesia' entra junto com 'anual' (26/08): a compra de produto passou a conceder
    // plano por N meses (regra `produto.concede_plano`), e o acesso concedido precisa
    // VENCER. Filtrar só por 'anual' deixaria a cortesia sem rebaixamento nenhum — o
    // cliente ganharia 6 meses e ficaria com eles para sempre, sem erro e sem log.
    const { data: anuaisVencidos, error: eVenc } = await supabase.from('perfis')
      .select('id, role, plano_ciclo, plano_vencimento, ciclo_agendado, asaas_id, mp_preapproval_id')
      .in('plano_ciclo', ['anual', 'cortesia']).lt('plano_vencimento', grace)
      .in('role', ['top2', 'top2_anual']);
    // Sem esta checagem, uma falha de leitura vira "ninguém a rebaixar" — a lista vazia
    // que não sabe que falhou (forma nº 2 do CLAUDE.md). Um DELETE/UPDATE que não alcança
    // nada não dá erro, e o acesso pago seguiria de graça em silêncio.
    if (eVenc) throw new Error(`leitura de vencidos falhou: ${eVenc.message}`);
    for (const p of (anuaisVencidos || [])) {
      // FAIL-SAFE (B3): só rebaixa com CONFIRMAÇÃO de que não há mandato ativo. Qualquer
      // INCERTEZA (erro/timeout de gateway) → pula — um 5xx transitório na janela de renovação
      // NÃO pode derrubar quem está pagando (auto-recupera no próximo cron).
      let mandatoAtivo = false, incerto = false;
      const asaas = await checarAsaasAtivo(p.asaas_id);
      if (asaas.erro) incerto = true; else if (asaas.ativo) mandatoAtivo = true;
      if (!mandatoAtivo && p.mp_preapproval_id) {
        const pre = await mpGet(`/preapproval/${p.mp_preapproval_id}`);
        if (pre == null) incerto = true;                 // consulta MP falhou → INCERTO
        else if (pre.status === 'authorized') mandatoAtivo = true; // renovando → não rebaixa
      }
      if (mandatoAtivo || incerto) continue;
      // Anual encerrado (confirmado sem mandato): fim do acesso (nunca cobramos a mensal sem
      // reautorização — regra b é consent-based). Limpa âncora/agendamento; role_anterior p/ reativar.
      const upd = { role: 'explorador', role_anterior: p.role, plano_ciclo: null, plano_vencimento: null, ciclo_agendado: null };
      const { error: e2 } = await supabase.from('perfis').update(upd).eq('id', p.id);
      if (!e2) rebaixados++;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, verificados, corrigidos, rebaixados }), { headers: { 'Content-Type': 'application/json' } });
}
