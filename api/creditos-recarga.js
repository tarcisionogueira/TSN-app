/**
 * POST /api/creditos-recarga — confirma uma RECARGA de crédito paga e credita o saldo.
 * Fecha o "passo 7" do motor de crédito (creditar_credito existia no banco sem nenhum
 * chamador — a tela de Créditos não tinha como adicionar crédito; achado do dono 30/07).
 *
 * Body: { paymentId }  (pagamento Mercado Pago — PIX ou cartão do PagamentoServico)
 *
 * Segurança (o valor NUNCA vem do cliente):
 *  1. Busca o pagamento na API do MP — precisa estar approved.
 *  2. PROPÓSITO: metadata.proposito === 'recarga'. Sem isto, o endpoint aceitava
 *     QUALQUER pagamento 'servico' do usuário (assessoria de R$4.800, mensalidade…)
 *     como recarga → o cliente pagava um serviço e ainda ganhava o valor em saldo
 *     (bug bounty 31/07, item #1). O marcador é posto no mp-checkout na criação.
 *  3. Vínculo de dono: metadata.user_id === usuário autenticado. (Sem fallback por
 *     CPF: o PIX estático não carrega metadata/proposito e por isso não é aceito aqui
 *     — a recarga usa o pagamento dinâmico do mp-checkout, que carrega o marcador.)
 *  4. Idempotência: garantida no BANCO (índice único em credito_lancamentos.referencia
 *     + ON CONFLICT em creditar_credito) — imune a corrida, não só o SELECT prévio.
 *  5. Credita transaction_amount (valor real recebido) via RPC creditar_credito.
 */
import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
const RECARGA_MIN = 20;

async function sbFetch(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = getIP(req);
  const rl = await checkRateLimit(`creditos-recarga:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  if (!SUPABASE_URL || !SERVICE_KEY || !MP_TOKEN) return res.status(500).json({ error: 'Pagamento não configurado' });

  const paymentId = String(req.body?.paymentId || '').replace(/\D/g, '');
  if (!paymentId) return res.status(400).json({ error: 'paymentId obrigatório' });

  try {
    // 1) Pagamento real e aprovado no MP.
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    if (!mpRes.ok) return res.status(502).json({ error: 'Não foi possível consultar o pagamento' });
    const pg = await mpRes.json();
    // SÓ `approved` É DINHEIRO (16/08). `authorized` é reserva não capturada
    // (`net_received_amount: 0`) — creditar em cima disso é dar saldo gastável na
    // plataforma por dinheiro que ainda pode não entrar. Mesma família da assinatura
    // liberada por mandato `authorized` e do Pro anual em `ativar-pro-anual.js`.
    if (pg.status !== 'approved') {
      return res.status(409).json({ error: 'Pagamento ainda não aprovado', status: pg.status });
    }
    const valor = Number(pg.transaction_amount) || 0;
    if (valor < RECARGA_MIN) return res.status(400).json({ error: `Recarga mínima de R$ ${RECARGA_MIN}` });

    // 2) PROPÓSITO: só pagamento criado COMO recarga vira crédito (nunca uma assessoria/
    //    serviço/mensalidade do próprio usuário). O marcador é posto no mp-checkout.
    if (String(pg.metadata?.proposito || '') !== 'recarga') {
      return res.status(409).json({ error: 'Este pagamento não é uma recarga de crédito.' });
    }

    // 3) O pagamento é MESMO deste usuário (metadata gravado na criação — sem fallback
    //    por CPF, que aceitaria pagamentos sem o marcador de propósito).
    if (String(pg.metadata?.user_id || '') !== String(user.id)) {
      return res.status(403).json({ error: 'Não foi possível vincular este pagamento à sua conta. Fale com o suporte.' });
    }

    // 4) Credita o valor REAL recebido. A idempotência é ATÔMICA no banco (índice único
    //    em referencia + ON CONFLICT): reprocessar o mesmo paymentId devolve ja_creditado
    //    sem somar de novo, mesmo sob corrida (o SELECT-antes foi removido — era TOCTOU).
    const referencia = `mp_${paymentId}`;
    const rpc = await sbFetch('rpc/creditar_credito', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: user.id, p_valor: valor, p_origem: 'recarga', p_referencia: referencia }),
    });
    if (rpc.ok && rpc.data?.ja_creditado) return res.status(200).json({ ok: true, jaCreditado: true });
    if (!rpc.ok || rpc.data?.ok === false) {
      console.error('[creditos-recarga] creditar_credito falhou:', JSON.stringify(rpc.data).slice(0, 200));
      return res.status(500).json({ error: 'Pagamento confirmado, mas o crédito falhou. Fale com o suporte.', referencia });
    }
    auditLog({ acao: 'credito_recarga', user_id: user.id, ip, detalhes: { paymentId, valor }, sucesso: true });
    return res.status(200).json({ ok: true, valor, saldo: rpc.data?.saldo });
  } catch (e) {
    console.error('[creditos-recarga]', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
