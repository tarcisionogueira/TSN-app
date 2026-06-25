/**
 * POST /api/mp-verificar-pix
 * Verifica se chegou um pagamento PIX na conta MP com o valor e referência esperados.
 * Chamado a cada 8s pelo frontend durante o fluxo de confirmação.
 */
import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const MP_BASE = 'https://api.mercadopago.com';
const STATUS_APROVADO = new Set(['approved', 'authorized']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIP(req);
  const rl = checkRateLimit(`mp-verificar-pix:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'Pagamento não configurado' });

  const { paymentId, valor, referencia } = req.body || {};
  if (!paymentId && !valor) {
    return res.status(400).json({ error: 'paymentId ou valor obrigatório' });
  }

  try {
    // Verifica payment específico (criado via mp-checkout)
    if (paymentId) {
      const mpRes = await fetch(`${MP_BASE}/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      });
      if (!mpRes.ok) return res.status(502).json({ error: 'Erro ao consultar MP' });
      const data = await mpRes.json();
      const confirmado = STATUS_APROVADO.has(data.status);
      return res.json({
        confirmado,
        status: data.status,
        statusDetalhe: data.status_detail,
        valor: data.transaction_amount,
      });
    }

    // Busca por pagamentos PIX recentes (últimas 30min) com o valor esperado
    const desde = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const url = `${MP_BASE}/v1/payments/search?payment_type_id=account_money,pix&begin_date=${desde}&status=approved&limit=20`;
    const mpRes = await fetch(url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) return res.status(502).json({ error: 'Erro ao consultar MP' });
    const { results } = await mpRes.json();

    const valorEsperado = Number(valor);
    const pagamento = (results || []).find(p => {
      const valorBate = Math.abs(p.transaction_amount - valorEsperado) < 0.02;
      const refBate = !referencia || p.external_reference === referencia || p.metadata?.referencia === referencia;
      return valorBate && refBate;
    });

    return res.json({
      confirmado: !!pagamento,
      status: pagamento?.status || 'pending',
      paymentId: pagamento?.id || null,
      valor: pagamento?.transaction_amount || null,
    });
  } catch (e) {
    console.error('[mp-verificar-pix]', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
