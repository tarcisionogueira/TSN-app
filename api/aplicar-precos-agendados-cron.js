/**
 * /api/aplicar-precos-agendados-cron — aplica os preços AGENDADOS (gatilho de preço, passo 8)
 * cuja vigência já chegou. Vira o preço direto no planos_config (fonte única lida pelo front e
 * pelo back), então a partir da virada todo novo checkout já cobra o preço novo.
 *
 * REGRA DO DONO (30/07 — fim do grandfather de preço): assinantes ATIVOS também passam a
 * pagar o preço novo na MENSALIDADE SEGUINTE. Depois de aplicar no planos_config, este cron
 * propaga a mudança para as recorrências vivas nos gateways:
 *   - Asaas: PUT /subscriptions/{id} value=novo (updatePendingPayments=false → só a próxima
 *     fatura muda; a já emitida não é reemitida). Localiza por ciclo + valor ANTIGO exato
 *     (não mexe em valores que não batem — ex.: legado 99,90 segue como está até o dono decidir).
 *   - Mercado Pago: PUT /preapproval/{id} auto_recurring.transaction_amount=novo. Localiza
 *     por external_reference (userId|planoKey) + valor antigo.
 * ASSESSORIA fica FORA: é parcelamento finito (12×) de contrato fechado — preço não muda no meio.
 *
 * Idempotente: se nada venceu, não faz nada. Roda 1×/dia (vercel.json). CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();
const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();

// Planos com recorrência ABERTA (mensalidade sem fim) que acompanham o preço vigente.
const PLANOS_RECORRENTES = ['top2', 'clube'];
const mesmoValor = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05;

async function sincronizarAsaas(mudanca, resumo) {
  if (!ASAAS_KEY) return;
  const alvos = [
    { ciclo: 'MONTHLY', antigo: mudanca.preco_antigo, novo: mudanca.preco_novo },
    { ciclo: 'YEARLY', antigo: mudanca.preco_anual_antigo, novo: mudanca.preco_anual_novo },
  ].filter(a => a.antigo != null && a.novo != null && !mesmoValor(a.antigo, a.novo));
  if (!alvos.length) return;
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await fetch(`${ASAAS_URL}/subscriptions?status=ACTIVE&limit=100&offset=${offset}`, { headers: { access_token: ASAAS_KEY } });
    if (!r.ok) { resumo.erros.push(`asaas_list_${r.status}`); break; }
    const data = await r.json().catch(() => null);
    const subs = data?.data || [];
    for (const sub of subs) {
      const alvo = alvos.find(a => a.ciclo === sub.cycle && mesmoValor(sub.value, a.antigo));
      if (!alvo) continue;
      const up = await fetch(`${ASAAS_URL}/subscriptions/${sub.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', access_token: ASAAS_KEY },
        body: JSON.stringify({ value: alvo.novo, updatePendingPayments: false }),
      });
      if (up.ok) resumo.asaas++; else resumo.erros.push(`asaas_put_${sub.id}_${up.status}`);
    }
    if (!data?.hasMore) break;
  }
}

async function sincronizarMP(mudanca, resumo) {
  if (!MP_TOKEN) return;
  const antigo = mudanca.preco_antigo, novo = mudanca.preco_novo;
  if (antigo == null || novo == null || mesmoValor(antigo, novo)) return;
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await fetch(`https://api.mercadopago.com/preapproval/search?status=authorized&offset=${offset}&limit=100`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    if (!r.ok) { resumo.erros.push(`mp_list_${r.status}`); break; }
    const data = await r.json().catch(() => null);
    const results = data?.results || [];
    if (!results.length) break;
    for (const sub of results) {
      const planoKey = String(sub.external_reference || '').split('|')[1];
      if (planoKey !== mudanca.plano_key) continue;
      const valorAtual = sub?.auto_recurring?.transaction_amount;
      if (!mesmoValor(valorAtual, antigo)) continue;
      const up = await fetch(`https://api.mercadopago.com/preapproval/${sub.id}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_recurring: { transaction_amount: novo, currency_id: 'BRL' } }),
      });
      if (up.ok) resumo.mp++; else resumo.erros.push(`mp_put_${sub.id}_${up.status}`);
    }
    if (offset + 100 >= Number(data?.paging?.total || 0)) break;
  }
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'env ausente' }); return; }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/aplicar_precos_agendados`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const mudancas = await r.json().catch(() => null);
    if (!r.ok) { res.status(500).json({ ok: false, mudancas }); return; }

    // Propaga aos assinantes ativos (mensalidade seguinte) — só recorrência aberta.
    const resumo = { asaas: 0, mp: 0, erros: [] };
    for (const m of (Array.isArray(mudancas) ? mudancas : [])) {
      if (!PLANOS_RECORRENTES.includes(m.plano_key)) continue;
      try { await sincronizarAsaas(m, resumo); } catch (e) { resumo.erros.push(`asaas_${m.plano_key}: ${e.message}`); }
      try { await sincronizarMP(m, resumo); } catch (e) { resumo.erros.push(`mp_${m.plano_key}: ${e.message}`); }
    }
    if (resumo.erros.length) console.error('[precos-agendados] erros de propagação:', resumo.erros.join(' · '));
    res.status(200).json({ ok: true, aplicados: (mudancas || []).length, mudancas, propagacao: resumo });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
