/**
 * Webhook Asaas → normaliza eventos e delega ao _webhook-core.js
 * Documentação Asaas: https://docs.asaas.com/reference/webhooks
 */
import {
  processarConfirmado,
  processarVencido,
  processarRecusado,
} from './_webhook-core.js';

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
    require('crypto').timingSafeEqual(Buffer.from(received), Buffer.from(webhookToken));
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
  const contexto  = {
    gateway:           'asaas',
    valor:             pag?.value,
    descricao:         pag?.description || '',
    email:             pag?.customer?.email || null,
    gatewayCustomerId: pag?.customer?.id   || null,
    gatewayPaymentId:  pag?.id             || null,
  };

  try {
    if (tipo === 'PAYMENT_CONFIRMED' || tipo === 'PAYMENT_RECEIVED') {
      const result = await processarConfirmado(contexto);
      return res.status(200).json(result);
    }
    if (tipo === 'PAYMENT_OVERDUE') {
      const result = await processarVencido(contexto);
      return res.status(200).json(result);
    }
    if (tipo === 'PAYMENT_REFUSED') {
      const result = await processarRecusado({
        ...contexto,
        motivo: pag?.refusedReason || 'PAYMENT_REFUSED',
      });
      return res.status(200).json(result);
    }
    // Eventos ignorados (PAYMENT_CREATED, etc.)
    return res.status(200).json({ ok: true, ignored: tipo });
  } catch (e) {
    console.error('[asaas-webhook]', e.message);
    return res.status(500).json({ error: 'Erro interno no webhook' });
  }
}
