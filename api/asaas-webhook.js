/**
 * Webhook Asaas → normaliza eventos e delega ao _webhook-core.js
 * Documentação Asaas: https://docs.asaas.com/reference/webhooks
 */
import crypto from 'crypto';
import {
  processarConfirmado,
  processarVencido,
  processarRecusado,
  processarChargeback,
  processarReembolso,
  eventoJaProcessado,
  removerEventoProcessado,
} from './_webhook-core.js';

const EVENTOS_CHARGEBACK = [
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  'PAYMENT_DISPUTE',
  'CHARGEBACK',
];

// Reembolso (refund) — antes caíam em "ignorados": a comissão de rede NÃO era estornada e
// o plano NÃO era suspenso (refund + comissão paga = perda dupla / fraude). Total suspende;
// parcial só estorna a comissão (cliente pagou a maior parte).
const EVENTOS_REEMBOLSO_TOTAL = ['PAYMENT_REFUNDED'];
const EVENTOS_REEMBOLSO_PARCIAL = ['PAYMENT_PARTIALLY_REFUNDED'];

// Compra AVULSA de produto: o pagamento carrega externalReference = compras_produtos.id
// (uuid). Esse caminho é 100% separado do de PLANO (nunca eleva role): ativa a compra e
// credita a comissão do parceiro via RPC service-role.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_SVC = process.env.SUPABASE_SERVICE_KEY;
async function rpcProduto(fn, payload) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    return r.ok ? await r.json() : { ok: false, http: r.status };
  } catch (e) { return { ok: false, erro: String(e?.message || e) }; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verifica token secreto — rejeita sempre se não configurado ou inválido
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!webhookToken) {
    console.error('[asaas] ASAAS_WEBHOOK_TOKEN não configurado — rejeitando webhook');
    return res.status(500).json({ error: 'Webhook não configurado' });
  }
  const received = req.headers['asaas-access-token']
    || req.headers['authorization']?.replace('Bearer ', '');
  const tokOk = received && received.length === webhookToken.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(webhookToken));
  if (!tokOk) {
    console.warn('[asaas] token inválido ou ausente');
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const event = req.body;
  if (!event?.event || !event?.payment) {
    return res.status(400).json({ error: 'Payload inválido' });
  }

  const tipo      = event.event;
  const pag       = event.payment;
  if (!pag?.id) return res.status(400).json({ error: 'Pagamento sem id' });

  // SEGURANÇA: NÃO confiar nos valores do corpo (valor/customer/status poderiam ser
  // forjados por quem obtivesse o token). Re-busca o pagamento na API do Asaas por id
  // e usa os valores AUTORITATIVOS — mesmo modelo do webhook do Mercado Pago, que
  // refaz o fetch. Sem isso, o token era o único fator e um POST forjado elevava plano.
  const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
  const ASAAS_API_KEY = (process.env.ASAAS_API_KEY || '').trim();
  if (!ASAAS_API_KEY) return res.status(500).json({ error: 'ASAAS_API_KEY não configurado' });
  let pagReal = null;
  try {
    const rr = await fetch(`${ASAAS_URL}/payments/${encodeURIComponent(pag.id)}`, {
      headers: { access_token: ASAAS_API_KEY }, signal: AbortSignal.timeout(10000),
    });
    if (rr.ok) pagReal = await rr.json();
  } catch { /* rede/timeout → cai no 502 abaixo (Asaas reenvia depois) */ }
  if (!pagReal?.id) return res.status(502).json({ error: 'Falha ao verificar pagamento no Asaas' });

  const valor = Number(pagReal.value);
  if (!valor || valor <= 0) return res.status(400).json({ error: 'Valor de pagamento inválido' });

  // Confirmação só eleva se a API confirma status pago DE FATO (defende contra um
  // evento "confirmado" forjado sobre um pagamento que não foi pago).
  const STATUS_PAGO = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
  if ((tipo === 'PAYMENT_CONFIRMED' || tipo === 'PAYMENT_RECEIVED') && !STATUS_PAGO.has(pagReal.status)) {
    return res.status(200).json({ ok: true, ignorado: 'status_nao_pago', status: pagReal.status });
  }

  // Idempotência: o Asaas reenvia eventos. Se já tratamos este (pagamento, evento),
  // responde OK sem reprocessar.
  if (await eventoJaProcessado({ gateway: 'asaas', gatewayPaymentId: pagReal.id, evento: tipo })) {
    return res.status(200).json({ ok: true, duplicado: true });
  }

  // O Asaas retorna payment.customer como STRING (id do cliente, ex. "cus_000...").
  const cust = pagReal.customer;
  const custId    = typeof cust === 'string' ? cust : (cust?.id || null);
  const custEmail = (cust && typeof cust === 'object') ? (cust.email || null) : null;
  const contexto  = {
    gateway:           'asaas',
    valor,
    descricao:         pagReal.description || '',
    email:             custEmail,
    gatewayCustomerId: custId,
    gatewayPaymentId:  pagReal.id,
  };

  // Produto avulso? externalReference = compras_produtos.id (uuid). Roteia para o
  // fluxo de PRODUTO (nunca para o de plano) — não pode elevar assinatura.
  const extRef = String(pagReal.externalReference || '').trim();
  const ehProduto = UUID_RE.test(extRef);

  try {
    if (tipo === 'PAYMENT_CONFIRMED' || tipo === 'PAYMENT_RECEIVED') {
      if (ehProduto) {
        const result = await rpcProduto('confirmar_compra_produto', { p_compra_id: extRef, p_gateway: 'asaas', p_gateway_payment_id: pagReal.id });
        if (result && result.ok === false) {
          // Efeito falhou → desmarca a idempotência e devolve 5xx para o Asaas REENVIAR.
          // Sem isso a compra ficaria presa em 'pendente' e a comissão nunca creditaria
          // (não há cron de reconciliação de compras_produtos).
          await removerEventoProcessado({ gateway: 'asaas', gatewayPaymentId: pagReal.id, evento: tipo });
          return res.status(502).json({ error: 'confirmar_compra_produto_falhou', detalhe: result });
        }
        return res.status(200).json({ ok: true, produto: result });
      }
      const result = await processarConfirmado(contexto);
      return res.status(200).json(result);
    }
    if (tipo === 'PAYMENT_OVERDUE') {
      // Compra AVULSA de produto (curso/e-book) não é assinatura: boleto/pix não pago só deixa
      // a compra pendente. Sem este guard, o assinante em dia que abandonava um boleto de
      // produto caía em processarVencido → role rebaixado p/ explorador, inadimplente_desde,
      // plano_vencimento zerado e documentos com prazo de expiração. Os fluxos de confirmação,
      // chargeback e reembolso já separavam produto × plano; overdue/refused ficaram de fora.
      if (ehProduto) return res.status(200).json({ ok: true, ignorado: 'produto_vencido' });
      const result = await processarVencido(contexto);
      return res.status(200).json(result);
    }
    if (tipo === 'PAYMENT_REFUSED') {
      if (ehProduto) return res.status(200).json({ ok: true, ignorado: 'produto_recusado' });
      const result = await processarRecusado({
        ...contexto,
        motivo: pag?.refusedReason || 'PAYMENT_REFUSED',
      });
      return res.status(200).json(result);
    }
    if (EVENTOS_CHARGEBACK.includes(tipo)) {
      if (ehProduto) {
        const result = await rpcProduto('estornar_compra_produto', { p_gateway_payment_id: pagReal.id });
        if (result && result.ok === false) {
          await removerEventoProcessado({ gateway: 'asaas', gatewayPaymentId: pagReal.id, evento: tipo });
          return res.status(502).json({ error: 'estornar_compra_produto_falhou', detalhe: result });
        }
        return res.status(200).json({ ok: true, produto_estorno: result });
      }
      const result = await processarChargeback({
        ...contexto,
        gatewaySubscriptionId: pag?.subscription || null,
        evento: tipo,
        motivo: pag?.chargeback?.reason || pag?.chargeback?.status || tipo,
        raw: event,
      });
      return res.status(200).json(result);
    }
    // Reembolso (refund): estorna a comissão de rede e (no total) suspende o acesso.
    if (EVENTOS_REEMBOLSO_TOTAL.includes(tipo) || EVENTOS_REEMBOLSO_PARCIAL.includes(tipo)) {
      const parcial = EVENTOS_REEMBOLSO_PARCIAL.includes(tipo);
      if (ehProduto) {
        // Produto é one-shot: só estorna no reembolso TOTAL.
        if (parcial) return res.status(200).json({ ok: true, ignorado: 'reembolso_parcial_produto' });
        const result = await rpcProduto('estornar_compra_produto', { p_gateway_payment_id: pagReal.id });
        if (result && result.ok === false) {
          await removerEventoProcessado({ gateway: 'asaas', gatewayPaymentId: pagReal.id, evento: tipo });
          return res.status(502).json({ error: 'estornar_compra_produto_falhou', detalhe: result });
        }
        return res.status(200).json({ ok: true, produto_estorno: result });
      }
      const result = await processarReembolso({ ...contexto, suspender: !parcial });
      return res.status(200).json(result);
    }
    // Eventos ignorados (PAYMENT_CREATED, etc.)
    return res.status(200).json({ ok: true, ignored: tipo });
  } catch (e) {
    console.error('[asaas-webhook]', e.message);
    // O efeito falhou APÓS a marca de idempotência → desmarca para o Asaas reenviar
    // (senão o reenvio seria deduplicado e o efeito nunca completaria).
    await removerEventoProcessado({ gateway: 'asaas', gatewayPaymentId: pagReal.id, evento: tipo });
    return res.status(500).json({ error: 'Erro interno no webhook' });
  }
}
