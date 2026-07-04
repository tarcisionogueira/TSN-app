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
  eventoJaProcessado,
} from './_webhook-core.js';

const EVENTOS_CHARGEBACK = [
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  'PAYMENT_DISPUTE',
  'CHARGEBACK',
];

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
  const valor = Number(pag?.value);
  if (!valor || valor <= 0) return res.status(400).json({ error: 'Valor de pagamento inválido' });

  // Idempotência: o Asaas reenvia eventos. Se já tratamos este (pagamento,
  // evento), responde OK sem reprocessar.
  if (await eventoJaProcessado({ gateway: 'asaas', gatewayPaymentId: pag?.id, evento: tipo })) {
    return res.status(200).json({ ok: true, duplicado: true });
  }

  // O Asaas envia payment.customer como STRING (id do cliente, ex. "cus_000...")
  // — não como objeto. Ler .id/.email direto resultava em null e a confirmação
  // virava no-op (perfil_nao_encontrado). Tolera os dois formatos.
  const cust = pag?.customer;
  const custId    = typeof cust === 'string' ? cust : (cust?.id || null);
  const custEmail = (cust && typeof cust === 'object') ? (cust.email || null) : null;
  const contexto  = {
    gateway:           'asaas',
    valor,
    descricao:         pag?.description || '',
    email:             custEmail,
    gatewayCustomerId: custId,
    gatewayPaymentId:  pag?.id || null,
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
    if (EVENTOS_CHARGEBACK.includes(tipo)) {
      const result = await processarChargeback({
        ...contexto,
        gatewaySubscriptionId: pag?.subscription || null,
        evento: tipo,
        motivo: pag?.chargeback?.reason || pag?.chargeback?.status || tipo,
        raw: event,
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
