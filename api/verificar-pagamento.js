import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';
// Verifica com o Asaas se a assinatura/cobrança avulsa foi paga.
// Chamado pelo Checkout a cada 8s para liberar o fluxo sem depender do clique do usuário.

const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';
const API_KEY = (process.env.ASAAS_API_KEY || '').trim();

const STATUS_PAGO = new Set(['RECEIVED', 'CONFIRMED']);

async function asaasGet(path) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    headers: { 'access_token': API_KEY },
  });
  if (!res.ok) throw new Error(`Asaas ${res.status}: ${path}`);
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!API_KEY) return res.status(500).json({ error: 'ASAAS_API_KEY não configurada' });

  const ip = getIP(req);
  const rl = checkRateLimit(`verificar-pagamento:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { subscriptionId, paymentId } = req.body || {};
  if (!subscriptionId && !paymentId) {
    return res.status(400).json({ error: 'subscriptionId ou paymentId obrigatório' });
  }

  try {
    if (paymentId) {
      const p = await asaasGet(`/payments/${paymentId}`);
      const confirmado = STATUS_PAGO.has(p.status);
      auditLog({ acao: 'verificar_pagamento', user_id: user.id, ip, detalhes: { paymentId, status: p.status }, sucesso: true });
      return res.json({ confirmado, status: p.status, dueDate: p.dueDate });
    }

    // Assinatura recorrente — busca a primeira cobrança da assinatura
    const data = await asaasGet(`/payments?subscription=${subscriptionId}&limit=10`);
    const pagamentos = data.data || [];
    // Considera confirmado se qualquer cobrança foi paga
    const pago = pagamentos.find(p => STATUS_PAGO.has(p.status));
    const status = pago ? pago.status : (pagamentos[0]?.status || 'PENDING');
    return res.json({ confirmado: !!pago, status, dueDate: pagamentos[0]?.dueDate });
  } catch (e) {
    console.error('verificar-pagamento:', e.message);
    return res.status(502).json({ error: 'Erro ao verificar pagamento' });
  }
}
