import { getUser, getAsaasIdById, getCpfById } from './_auth.js';
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
  const rl = await checkRateLimit(`verificar-pagamento:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { subscriptionId, paymentId } = req.body || {};
  if (!subscriptionId && !paymentId) {
    return res.status(400).json({ error: 'subscriptionId ou paymentId obrigatório' });
  }

  // Ownership: o customer do pagamento/assinatura tem que ser o do próprio usuário
  // (evita IDOR — ler/confirmar cobrança de terceiro por ID).
  //
  // CORREÇÃO 07/08 (achado ALTA da varredura de 05/08): a checagem era `if (asaasId && …)`,
  // ou seja, ela só existia para quem JÁ tinha asaas_id. Todo Explorador grátis — e qualquer
  // conta antes do 1º pagamento — tem asaas_id null, então a verificação era PULADA e bastava
  // iterar paymentId/subscriptionId para ler status e vencimento de cobranças de OUTROS
  // clientes. O motivo original é legítimo (no 1º checkout o asaas_id ainda não existe), mas
  // "não sei quem é o dono" tem que virar uma SEGUNDA prova, não a ausência de prova: agora,
  // sem asaas_id, confirmamos pelo e-mail/CPF do customer da própria cobrança.
  const asaasId = await getAsaasIdById(user.id);
  // Fallback de titularidade para quem ainda não tem asaas_id: compara o customer da cobrança
  // com os dados da conta autenticada. Só libera com IGUALDADE — na dúvida, 403.
  const donoPeloCadastro = async (customerId) => {
    if (!customerId) return false;
    try {
      const c = await asaasGet(`/customers/${customerId}`);
      const emailUser = String(user.email || '').trim().toLowerCase();
      const emailCli = String(c?.email || '').trim().toLowerCase();
      if (emailUser && emailCli && emailUser === emailCli) return true;
      const cpfUser = String(await getCpfById(user.id) || '').replace(/\D/g, '');
      const cpfCli = String(c?.cpfCnpj || '').replace(/\D/g, '');
      return !!(cpfUser && cpfCli && cpfUser === cpfCli);
    } catch { return false; }
  };
  const negar = () => res.status(403).json({ error: 'Acesso negado' });

  try {
    if (paymentId) {
      const p = await asaasGet(`/payments/${paymentId}`);
      if (asaasId ? p.customer !== asaasId : !(await donoPeloCadastro(p.customer))) return negar();
      const confirmado = STATUS_PAGO.has(p.status);
      auditLog({ acao: 'verificar_pagamento', user_id: user.id, ip, detalhes: { paymentId, status: p.status }, sucesso: true });
      return res.json({ confirmado, status: p.status, dueDate: p.dueDate });
    }

    // Assinatura recorrente — valida o dono e busca a primeira cobrança. Mesma regra do
    // pagamento avulso: SEMPRE prova a titularidade, pelo asaas_id ou pelo cadastro.
    const sub = await asaasGet(`/subscriptions/${subscriptionId}`);
    if (asaasId ? sub.customer !== asaasId : !(await donoPeloCadastro(sub.customer))) return negar();
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
