/**
 * Festa da Colheita — Cobrança avulsa via Mercado Pago
 * PIX e cartão de crédito, valor aberto.
 * Expira automaticamente após 2026-06-26.
 */
export const config = { runtime: 'edge' };

const MP_BASE = 'https://api.mercadopago.com';
const EXPIRA_EM = '2026-06-26'; // YYYY-MM-DD (fuso America/Bahia = UTC-3)

export default async function handler(req) {
  // Expiração: bloqueia após o dia do evento
  const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bahia' }));
  const limite = new Date(EXPIRA_EM + 'T23:59:59');
  if (hoje > limite) {
    return new Response(JSON.stringify({ error: 'Encerrado' }), { status: 410 });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405 });
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    return new Response(JSON.stringify({ error: 'Pagamento não configurado' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 });
  }

  const { valor, metodo, token, parcelas, metodoPagamentoId, payerEmail } = body;

  if (!valor || !metodo) {
    return new Response(JSON.stringify({ error: 'valor e metodo são obrigatórios' }), { status: 400 });
  }

  const valorNum = parseFloat(String(valor).replace(',', '.'));
  if (isNaN(valorNum) || valorNum < 1) {
    return new Response(JSON.stringify({ error: 'Valor mínimo R$ 1,00' }), { status: 400 });
  }

  const email = payerEmail || 'comprador@festadacolheita.com';

  const payload = {
    transaction_amount: valorNum,
    description: 'Padaria Mascote — Festa da Colheita 2026',
    payer: { email },
    statement_descriptor: 'PADARIAMASCOTE',
  };

  if (metodo === 'pix') {
    payload.payment_method_id = 'pix';
  } else if (metodo === 'credit_card') {
    if (!token || !metodoPagamentoId) {
      return new Response(JSON.stringify({ error: 'Dados do cartão incompletos' }), { status: 400 });
    }
    payload.payment_method_id = metodoPagamentoId;
    payload.token = token;
    payload.installments = parseInt(parcelas) || 1;
    // Juros do parcelamento repassados ao cliente via configuração da conta MP
  } else {
    return new Response(JSON.stringify({ error: 'Método inválido' }), { status: 400 });
  }

  try {
    const mpRes = await fetch(`${MP_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        // Chave idempotente determinística: retry do mesmo pagamento não duplica cobrança.
        'X-Idempotency-Key': `festa-${metodo}-${(payload?.payer?.email || '')}-${payload?.transaction_amount || 0}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.error('[festa-pagamento] erro MP:', JSON.stringify(data));
      const msg = data?.message || data?.cause?.[0]?.description || 'Pagamento recusado';
      return new Response(JSON.stringify({ error: msg }), { status: 422 });
    }

    return new Response(JSON.stringify({
      ok: true,
      paymentId: data.id,
      status: data.status,
      statusDetalhe: data.status_detail,
      qrCode: data.point_of_interaction?.transaction_data?.qr_code || null,
      qrCodeBase64: data.point_of_interaction?.transaction_data?.qr_code_base64 || null,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
      },
    });
  } catch (e) {
    console.error('[festa-pagamento]', e.message);
    return new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500 });
  }
}
