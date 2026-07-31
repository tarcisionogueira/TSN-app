/**
 * Mercado Pago — Checkout Transparente
 * Cria preferência de pagamento (cartão, PIX, boleto)
 * Dinheiro fica na conta MP da TSN; profissionais sacam sob demanda.
 *
 * Env vars:
 *   MP_ACCESS_TOKEN  — access_token da conta MP da plataforma (produção)
 *   MP_PUBLIC_KEY    — public_key (usada no frontend para tokenizar cartão)
 */
import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const MP_BASE = 'https://api.mercadopago.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIP(req);
  const rl = await checkRateLimit(`mp-checkout:${ip}`, 10, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas. Aguarde.' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'Pagamento não configurado' });

  const { valor, descricao, email, metodoPagamento, dadosCartao } = req.body;
  if (!valor || !descricao || !email) {
    return res.status(400).json({ error: 'valor, descricao e email são obrigatórios' });
  }
  // Propósito do pagamento avulso (allowlist). Marca a INTENÇÃO no metadata para que o
  // confirmador correto o aceite — sem isso, /api/creditos-recarga aceitava QUALQUER
  // pagamento 'servico' do usuário (assessoria, etc.) como recarga (bug bounty #1).
  const PROPOSITOS = new Set(['servico', 'recarga']);
  const proposito = PROPOSITOS.has(String(req.body?.proposito)) ? String(req.body.proposito) : 'servico';

  const valorCentavos = Math.round(Number(valor) * 100);
  if (valorCentavos < 100) return res.status(400).json({ error: 'Valor mínimo R$ 1,00' });

  try {
    const payload = {
      transaction_amount: Number(valor),
      description: String(descricao).slice(0, 256),
      payment_method_id: metodoPagamento || 'pix',
      payer: { email: String(email) },
      // SEGURANÇA: este endpoint é SEMPRE pagamento avulso de serviço (tipo='servico').
      // Nunca eleva plano/role — senão um cliente pagaria 1x um valor qualquer e o
      // webhook mapearia valor→plano, virando plano vitalício de graça (pagamento único
      // não gera preapproval, então nada revoga). Assinaturas de plano vão por /api/mp
      // (preapproval), onde o preço vem do servidor (planos_config) e é recorrente.
      metadata: { user_id: user.id, origem: 'tsn-app', tipo: 'servico', proposito },
      notification_url: `${process.env.APP_BASE_URL || 'https://bidprobrasil.com.br'}/api/mp-webhook`,
      statement_descriptor: 'BIDPRO BRASIL',
    };

    // Cartão de crédito: requer token gerado pelo SDK MP no frontend
    if (metodoPagamento === 'credit_card' && dadosCartao?.token) {
      payload.token = dadosCartao.token;
      payload.installments = dadosCartao.parcelas || 1;
      payload.payment_method_id = dadosCartao.metodoPagamentoId;
    }

    // Chave idempotente.
    // - Cartão: o token é single-use → a chave determinística já impede duplicar a
    //   cobrança num retry do MESMO token (double-submit).
    // - PIX: sem nonce, uma NOVA tentativa do mesmo valor recai no pagamento anterior
    //   (que pode ter expirado/sido cancelado), quebrando o fluxo do cliente. Por isso
    //   a chave leva um componente único por tentativa (idempotencyKey do front, se
    //   enviado, ou timestamp). PIX não gera cobrança automática — cada QR é pago à parte.
    const idemBase = `tsn-${user.id}-${payload.token || 'pix'}-${payload.transaction_amount || 0}`;
    const idemKey = payload.token
      ? idemBase
      : `${idemBase}-${String(req.body?.idempotencyKey || Date.now()).slice(0, 40)}`;
    const mpRes = await fetch(`${MP_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idemKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.error('[mp-checkout] erro MP:', data);
      return res.status(422).json({ error: 'Pagamento recusado', codigo: data?.cause?.[0]?.code || 'unknown' });
    }

    await auditLog({ acao: 'mp_checkout_criado', user_id: user.id, ip, detalhes: { payment_id: data.id, valor, metodo: metodoPagamento }, sucesso: true });

    return res.status(200).json({
      ok: true,
      paymentId: data.id,
      status: data.status,
      statusDetalhe: data.status_detail,
      // PIX: QR code
      qrCode: data.point_of_interaction?.transaction_data?.qr_code || null,
      qrCodeBase64: data.point_of_interaction?.transaction_data?.qr_code_base64 || null,
      // Boleto
      boletoUrl: data.transaction_details?.external_resource_url || null,
    });
  } catch (e) {
    console.error('[mp-checkout]', e.message);
    return res.status(500).json({ error: 'Erro interno no pagamento' });
  }
}
