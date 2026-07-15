/**
 * POST /api/mp-admin
 * Endpoints internos para o painel admin (saldo, listagem de pagamentos).
 * Requer role=admin.
 */

export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const MP_URL      = 'https://api.mercadopago.com';
const TOKEN       = (process.env.MP_ACCESS_TOKEN || '').trim();
const SUPABASE    = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function isAdmin(userId) {
  const res = await fetch(`${SUPABASE}/rest/v1/perfis?id=eq.${userId}&select=role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const rows = await res.json();
  return rows?.[0]?.role === 'admin';
}

async function mpGet(path) {
  const res = await fetch(`${MP_URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) { const d = await res.json(); throw new Error(d.message || `MP ${res.status}`); }
  return res.json();
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  // getAuthUser retorna null (não lança); sem este guard, isAdmin(user.id) quebra
  const user = await getAuthUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  if (!(await isAdmin(user.id))) {
    return new Response(JSON.stringify({ error: 'Acesso negado' }), { status: 403 });
  }

  if (!TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN não configurado' }), { status: 500 });

  let body;
  try { body = await req.json(); } catch { body = {}; }

  try {
    if (body.action === 'saldo') {
      // O MP NÃO tem /v1/account/balance (retorna a página genérica de devs em
      // espanhol). O saldo vem de /users/{id}/mercadopago_account/balance.
      try {
        const me = await mpGet('/users/me');
        const bal = await mpGet(`/users/${me.id}/mercadopago_account/balance`);
        return new Response(JSON.stringify({
          available_balance:   Number(bal.available_balance ?? bal.available ?? 0),
          unavailable_balance: Number(bal.unavailable_balance ?? bal.unavailable ?? 0),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        // Algumas contas MP não expõem saldo pela API. Mensagem limpa (não o texto
        // cru do MP) para o painel não assustar com erro em espanhol.
        return new Response(JSON.stringify({
          indisponivel: true,
          error: 'O Mercado Pago não expõe o saldo desta conta pela API. Consulte o saldo direto no painel do Mercado Pago.',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (body.action === 'assinatura_email') {
      // Verifica a RECORRÊNCIA de um assinante: busca os preapprovals do MP pelo
      // e-mail e devolve status, próxima cobrança e valor. Confirma se a assinatura
      // vai continuar sendo cobrada (authorized) ou está pausada/cancelada.
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return new Response(JSON.stringify({ error: 'email obrigatório' }), { status: 400 });
      let results = [];
      try {
        const r = await mpGet(`/preapproval/search?payer_email=${encodeURIComponent(email)}&sort=date_created:desc&limit=20`);
        results = Array.isArray(r?.results) ? r.results : [];
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
      const assinaturas = results.map((s) => ({
        id: String(s.id),
        status: s.status, // authorized (cobrando) | pending | paused | cancelled
        reason: s.reason || null,
        valor: Number(s.auto_recurring?.transaction_amount ?? 0),
        frequencia: s.auto_recurring ? `${s.auto_recurring.frequency} ${s.auto_recurring.frequency_type}` : null,
        proximaCobranca: s.next_payment_date || s.auto_recurring?.end_date || null,
        criadaEm: s.date_created || null,
      }));
      const ativa = assinaturas.find((a) => a.status === 'authorized') || null;
      return new Response(JSON.stringify({
        email,
        temRecorrenciaAtiva: !!ativa,
        resumo: ativa
          ? `Recorrência ATIVA de ${ativa.valor ? 'R$ ' + ativa.valor.toFixed(2) : '—'}${ativa.proximaCobranca ? `, próxima cobrança ${String(ativa.proximaCobranca).slice(0, 10)}` : ''}.`
          : (assinaturas.length ? 'Há assinatura(s), mas NENHUMA ativa (pausada/cancelada) — não será cobrada.' : 'Nenhuma assinatura recorrente encontrada no Mercado Pago para este e-mail — pagamento foi avulso ou não há recorrência.'),
        assinaturas,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (body.action === 'transacoes') {
      // Fonte de verdade REAL: pagamentos direto na API do MP (não o nosso banco).
      // Mostra o valor da operação: bruto, taxa do MP e líquido efetivamente recebido.
      //
      // CRÍTICO (integridade financeira): a busca de pagamentos do MP devolve TUDO que
      // passa pela conta — inclusive pagamentos que a PRÓPRIA conta FEZ (ex.: compras no
      // cartão, "Anthropic"). Esses NÃO são receita e chegam a mostrar líquido > bruto.
      // Só contamos como RECEITA o que ESTA conta COLETOU de fato:
      //   (1) status = approved
      //   (2) operação de venda (regular_payment)
      //   (3) NÓS somos o recebedor (collector_id = nossa conta) — exclui o que pagamos
      //   (4) sanidade: líquido nunca excede o bruto (uma coleta real desconta a taxa)
      const limit = Math.min(Number(body.limit) || 30, 50);
      let meuId = null;
      try { const me = await mpGet('/users/me'); meuId = me?.id != null ? String(me.id) : null; } catch { /* sem /me: não exclui por recebedor */ }
      const search = await mpGet(`/v1/payments/search?sort=date_created&criteria=desc&limit=${limit}`);
      const results = Array.isArray(search?.results) ? search.results : [];
      const tx = results.map((p) => {
        const bruto = Number(p.transaction_amount || 0);
        const liquido = p.transaction_details?.net_received_amount != null
          ? Number(p.transaction_details.net_received_amount)
          : null;
        const taxa = liquido != null
          ? Math.max(0, Number((bruto - liquido).toFixed(2)))
          : (Array.isArray(p.fee_details) ? p.fee_details.reduce((s, f) => s + Number(f.amount || 0), 0) : null);
        const collectorId = p.collector_id ?? p.collector?.id ?? null;
        const somosRecebedor = (meuId == null || collectorId == null) ? true : String(collectorId) === meuId;
        const receita = p.status === 'approved'
          && (!p.operation_type || p.operation_type === 'regular_payment')
          && somosRecebedor
          && (liquido == null || liquido <= bruto + 0.005);
        return {
          id: String(p.id),
          status: p.status,
          status_detail: p.status_detail || null,
          bruto,
          liquido,
          taxa,
          receita,
          operacao: p.operation_type || null,
          data: p.date_approved || p.date_created || null,
          email: p.payer?.email || null,
          descricao: p.description || '',
          metodo: p.payment_method_id || null,
          parcelas: p.installments || null,
        };
      });
      // Só as RECEITAS entram na lista e nos totais (exclui pagamentos que a conta fez,
      // estornos e qualquer coisa com líquido > bruto) — dado financeiro tem de ser sólido.
      const receitas = tx.filter((t) => t.receita);
      const totalBruto = receitas.reduce((s, t) => s + t.bruto, 0);
      const totalLiquido = receitas.reduce((s, t) => s + (t.liquido ?? t.bruto), 0);
      return new Response(JSON.stringify({
        transacoes: receitas,
        excluidos: tx.length - receitas.length, // transparência: quantos não-receita foram descartados
        resumo: {
          qtdAprovados: receitas.length,
          totalBruto: Number(totalBruto.toFixed(2)),
          totalLiquido: Number(totalLiquido.toFixed(2)),
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (body.action === 'pagamentos') {
      // Últimos pagamentos do Supabase
      const res = await fetch(
        `${SUPABASE}/rest/v1/mp_pagamentos?order=criado_em.desc&limit=50`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      const data = await res.json();
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Action desconhecida' }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
