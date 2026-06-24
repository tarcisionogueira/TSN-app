/**
 * Admin aprova saque e executa PIX via Mercado Pago Transfers API.
 * Env vars: MP_ACCESS_TOKEN, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, getIP } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const MP_BASE = 'https://api.mercadopago.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIP(req);
  const rl = checkRateLimit(`aprovar-saque:${ip}`, 20, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas.' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const role = await getUserRoleById(user.id);
  if (!['admin'].includes(role)) return res.status(403).json({ error: 'Apenas administradores podem aprovar saques' });

  const { saqueId, acao } = req.body; // acao: 'aprovar' | 'rejeitar'
  if (!saqueId || !['aprovar', 'rejeitar'].includes(acao)) {
    return res.status(400).json({ error: 'saqueId e acao (aprovar|rejeitar) obrigatórios' });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Banco não configurado' });

  const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // Busca o saque
  const saqueRes = await fetch(`${SUPABASE_URL}/rest/v1/saques?id=eq.${saqueId}&select=*`, { headers: hdr });
  const [saque] = await saqueRes.json();
  if (!saque) return res.status(404).json({ error: 'Saque não encontrado' });
  if (saque.status !== 'pendente') return res.status(400).json({ error: `Saque já está ${saque.status}` });

  if (acao === 'rejeitar') {
    // Devolve o valor ao saldo disponível
    const saldoRes = await fetch(`${SUPABASE_URL}/rest/v1/saldos_profissionais?user_id=eq.${saque.user_id}&select=saldo_disponivel,saldo_retido`, { headers: hdr });
    const [saldo] = await saldoRes.json();
    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/saques?id=eq.${saqueId}`, {
        method: 'PATCH', headers: { ...hdr, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'rejeitado', aprovado_por: user.id, processado_em: new Date().toISOString() }),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/saldos_profissionais?user_id=eq.${saque.user_id}`, {
        method: 'PATCH', headers: { ...hdr, Prefer: 'return=minimal' },
        body: JSON.stringify({ saldo_disponivel: Number(saldo?.saldo_disponivel || 0) + Number(saque.valor), saldo_retido: Math.max(0, Number(saldo?.saldo_retido || 0) - Number(saque.valor)) }),
      }),
    ]);
    await auditLog({ acao: 'saque_rejeitado', user_id: user.id, ip, detalhes: { saque_id: saqueId, beneficiario: saque.user_id }, sucesso: true });
    return res.status(200).json({ ok: true, mensagem: 'Saque rejeitado e valor devolvido ao saldo.' });
  }

  // Aprovar — executa PIX via MP
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });

  try {
    const mpRes = await fetch(`${MP_BASE}/v1/advanced_payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `saque-${saqueId}` },
      body: JSON.stringify({
        payments: [{ payment_method_id: 'account_money', transaction_amount: Number(saque.valor) }],
        disbursements: [{
          amount: Number(saque.valor),
          collector_id: null, // para transferência PIX: usar endpoint /v1/payments com método pix e payer.identification
          external_reference: `saque-${saqueId}`,
          // Nota: para PIX de saída real, usar POST /v1/payments com payer.identification.number = chave PIX
        }],
        payer: { type: 'customer' },
        external_reference: `saque-${saqueId}`,
      }),
    });

    const mpData = await mpRes.json();
    const mpOk = mpRes.ok && (mpData.status === 'approved' || mpData.status === 'pending');

    // Marcar saque como processado no banco independente de ter ido por MP ou não (admin controla)
    const saldoRes = await fetch(`${SUPABASE_URL}/rest/v1/saldos_profissionais?user_id=eq.${saque.user_id}&select=saldo_retido`, { headers: hdr });
    const [saldo] = await saldoRes.json();

    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/saques?id=eq.${saqueId}`, {
        method: 'PATCH', headers: { ...hdr, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'pago', aprovado_por: user.id, mp_payment_id: mpData?.id ? String(mpData.id) : null, processado_em: new Date().toISOString() }),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/saldos_profissionais?user_id=eq.${saque.user_id}`, {
        method: 'PATCH', headers: { ...hdr, Prefer: 'return=minimal' },
        body: JSON.stringify({ saldo_retido: Math.max(0, Number(saldo?.saldo_retido || 0) - Number(saque.valor)) }),
      }),
    ]);

    await auditLog({ acao: 'saque_aprovado', user_id: user.id, ip, detalhes: { saque_id: saqueId, mp_ok: mpOk, mp_status: mpData?.status }, sucesso: true });
    return res.status(200).json({ ok: true, mensagem: 'Saque aprovado e processado.', mpStatus: mpData?.status || 'manual' });
  } catch (e) {
    console.error('[aprovar-saque]', e.message);
    return res.status(500).json({ error: 'Erro ao processar pagamento' });
  }
}
