/**
 * POST /api/mp-verificar-pix
 * Verifica se chegou um pagamento PIX na conta MP com o valor e referência esperados.
 * Chamado a cada 8s pelo frontend durante o fluxo de confirmação.
 */
import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';

const MP_BASE = 'https://api.mercadopago.com';
// SÓ `approved` É DINHEIRO (16/08). `authorized` é valor autorizado e NÃO CAPTURADO
// (`captured: false`, `status_detail: 'pending_capture'`, `net_received_amount: 0`):
// reserva no cartão, que pode nunca virar caixa. Este endpoint é o CONFIRMADOR que o
// front consulta a cada 8s — se ele aceitar `authorized`, todo o resto da correção de
// 16/08 cai junto, porque é justamente para cá que o pagamento pendente é encaminhado.
const STATUS_APROVADO = new Set(['approved']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIP(req);
  const rl = await checkRateLimit(`mp-verificar-pix:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

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
      // Ownership: o pagamento tem que ser do próprio usuário (metadata.user_id é
      // gravado no mp-checkout). Sem isso, um paymentId de terceiro confirmaria.
      if (String(data.metadata?.user_id || '') !== String(user.id)) {
        return res.json({ confirmado: false, status: 'pending', naoPertence: true });
      }
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
      // Vincula ao usuário autenticado via metadata.user_id (setado no mp-checkout).
      // Remove o antigo match por valor puro (`!referencia`), que confirmava o PIX
      // de outro usuário com o mesmo valor.
      const donoBate = String(p.metadata?.user_id || '') === String(user.id);
      return valorBate && donoBate;
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
