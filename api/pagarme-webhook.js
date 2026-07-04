/**
 * Webhook Pagar.me → normaliza eventos e delega ao _webhook-core.js
 * Documentação: https://docs.pagar.me/reference/webhooks
 *
 * Configurar no painel Pagar.me:
 *   URL: https://<seu-dominio>/api/pagarme-webhook
 *   Eventos: order.paid, order.payment_failed, charge.chargedback
 *
 * Variáveis de ambiente necessárias:
 *   PAGARME_WEBHOOK_SECRET — chave secreta configurada no painel Pagar.me
 *   PAGARME_API_KEY        — chave de API Pagar.me (para consultas futuras)
 */
import crypto from 'crypto';
import {
  processarConfirmado,
  processarVencido,
  processarRecusado,
} from './_webhook-core.js';

function verificarAssinatura(req) {
  const secret = process.env.PAGARME_WEBHOOK_SECRET;
  if (!secret) { console.error('[pagarme] PAGARME_WEBHOOK_SECRET não configurado — todos os webhooks serão rejeitados. Configure no painel Pagar.me.'); return false; }

  // Pagar.me envia HMAC-SHA256 no header X-Hub-Signature
  const signature = req.headers['x-hub-signature'] || '';
  const body = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  try { return crypto.timingSafeEqual(sigBuf, expBuf); } catch { return false; }
}

// Normaliza evento Pagar.me para o formato do _webhook-core
function normalizarEvento(event) {
  const tipo = event?.type || '';
  const dados = event?.data || {};

  // order.paid → pagamento confirmado
  if (tipo === 'order.paid') {
    const charge = dados.charges?.[0];
    const customer = dados.customer;
    return {
      acao:              'confirmado',
      valor:             (dados.amount || 0) / 100, // Pagar.me usa centavos
      descricao:         dados.items?.[0]?.description || '',
      email:             customer?.email || null,
      gatewayCustomerId: customer?.id   || null,
      gatewayPaymentId:  charge?.id     || dados.id || null,
    };
  }

  // charge.payment_failed → recusado
  if (tipo === 'charge.payment_failed') {
    const customer = dados.customer;
    return {
      acao:              'recusado',
      valor:             (dados.amount || 0) / 100,
      descricao:         '',
      email:             customer?.email || null,
      gatewayCustomerId: customer?.id   || null,
      gatewayPaymentId:  dados.id       || null,
      motivo:            dados.last_transaction?.acquirer_message || 'RECUSADO',
    };
  }

  // subscription.delinquent → inadimplente (vencido)
  if (tipo === 'subscription.delinquent') {
    const customer = dados.customer;
    return {
      acao:              'vencido',
      valor:             0,
      descricao:         '',
      email:             customer?.email || null,
      gatewayCustomerId: customer?.id   || null,
      gatewayPaymentId:  dados.id       || null,
    };
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!verificarAssinatura(req)) {
    console.warn('[pagarme] assinatura inválida');
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const normalizado = normalizarEvento(req.body);
  if (!normalizado) {
    return res.status(200).json({ ok: true, ignored: req.body?.type });
  }

  const contexto = { gateway: 'pagarme', ...normalizado };

  try {
    let result;
    if (normalizado.acao === 'confirmado') result = await processarConfirmado(contexto);
    else if (normalizado.acao === 'vencido') result = await processarVencido(contexto);
    else if (normalizado.acao === 'recusado') result = await processarRecusado(contexto);
    else result = { ok: true };

    return res.status(200).json(result);
  } catch (e) {
    console.error('[pagarme-webhook]', e.message);
    return res.status(500).json({ error: 'Erro interno no webhook' });
  }
}
