/**
 * Webhook Mercado Pago → normaliza e delega ao _webhook-core.js
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/notifications/webhooks
 *
 * Env vars:
 *   MP_ACCESS_TOKEN       — access_token para consultar o pagamento
 *   MP_WEBHOOK_SECRET     — secret configurado no painel MP (X-Signature header)
 */
import crypto from 'crypto';
import { processarConfirmado, processarVencido, processarRecusado, processarChargeback } from './_webhook-core.js';

const MP_BASE = 'https://api.mercadopago.com';

function verificarAssinatura(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;

  // MP envia x-signature: ts=<timestamp>,v1=<hmac>
  const xSig = req.headers['x-signature'] || '';
  const xReqId = req.headers['x-request-id'] || '';
  const match = xSig.match(/ts=(\d+),v1=([a-f0-9]+)/);
  if (!match) return false;

  const [, ts, v1] = match;
  const dataId = req.body?.data?.id || '';
  const template = `id:${dataId};request-id:${xReqId};ts:${ts};`;

  const expected = crypto.createHmac('sha256', secret).update(template).digest('hex');
  try {
    const eBuf = Buffer.from(expected);
    const vBuf = Buffer.from(v1);
    if (eBuf.length !== vBuf.length) return false;
    return crypto.timingSafeEqual(eBuf, vBuf);
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!verificarAssinatura(req)) {
    console.warn('[mp-webhook] assinatura inválida');
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const tipo = req.body?.type || req.body?.action || '';
  const dataId = req.body?.data?.id;

  // Apenas processar notificações de pagamento
  if (tipo !== 'payment' || !dataId) {
    return res.status(200).json({ ok: true, ignored: tipo });
  }

  // Busca detalhes completos do pagamento na API MP
  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });

  let pagamento;
  try {
    const r = await fetch(`${MP_BASE}/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!r.ok) return res.status(200).json({ ok: true, erro: 'payment not found' });
    pagamento = await r.json();
  } catch (e) {
    console.error('[mp-webhook] erro ao buscar pagamento:', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }

  const status = pagamento.status;
  const payer = pagamento.payer || {};
  const contexto = {
    gateway: 'mercadopago',
    valor: pagamento.transaction_amount || 0,
    descricao: pagamento.description || '',
    email: payer.email || null,
    gatewayCustomerId: payer.id ? String(payer.id) : null,
    gatewayPaymentId: String(pagamento.id),
    metadados: pagamento.metadata || {},
    // Pagamento avulso de serviço (não-assinatura): o webhook não deve elevar plano.
    servico: (pagamento.metadata?.tipo === 'servico'),
  };

  try {
    let result;
    if (status === 'approved') {
      result = await processarConfirmado(contexto);
    } else if (status === 'rejected' || status === 'cancelled') {
      result = await processarRecusado({ ...contexto, motivo: pagamento.status_detail || status });
    } else if (status === 'charged_back') {
      result = await processarChargeback({
        ...contexto,
        evento: 'charged_back',
        motivo: pagamento.status_detail || 'charged_back',
        raw: { id: pagamento.id, status, status_detail: pagamento.status_detail },
      });
    } else {
      // pending, in_process, authorized — aguardar próxima notificação
      return res.status(200).json({ ok: true, ignored: status });
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error('[mp-webhook]', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
