/**
 * Profissional solicita saque do saldo acumulado.
 * Admin aprova manualmente ou via api/aprovar-saque.js.
 * Modelo: dinheiro fica na conta MP da TSN; rende CDI; sai apenas quando aprovado.
 *
 * Env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const ROLES_PROFISSIONAL = ['consultor', 'analista', 'advogado', 'admin'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIP(req);
  const rl = checkRateLimit(`solicitar-saque:${ip}`, 5, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas. Aguarde.' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const role = await getUserRoleById(user.id);
  if (!ROLES_PROFISSIONAL.includes(role)) return res.status(403).json({ error: 'Acesso restrito a profissionais' });

  const { valor, chavePix, bancoNome } = req.body;
  if (!valor || !chavePix) return res.status(400).json({ error: 'valor e chavePix obrigatórios' });

  const valorNum = Number(valor);
  if (isNaN(valorNum) || valorNum < 10) return res.status(400).json({ error: 'Valor mínimo para saque: R$ 10,00' });

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Banco não configurado' });

  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // Verifica saldo disponível
  const saldoRes = await fetch(`${SUPABASE_URL}/rest/v1/saldos_profissionais?user_id=eq.${user.id}&select=saldo_disponivel`, { headers });
  const [saldo] = await saldoRes.json();
  const saldoDisp = Number(saldo?.saldo_disponivel || 0);

  if (saldoDisp < valorNum) {
    return res.status(400).json({ error: `Saldo insuficiente. Disponível: R$ ${saldoDisp.toFixed(2)}` });
  }

  // Verifica se há saque pendente
  const pendRes = await fetch(`${SUPABASE_URL}/rest/v1/saques?user_id=eq.${user.id}&status=eq.pendente&select=id`, { headers });
  const pendentes = await pendRes.json();
  if (pendentes?.length > 0) return res.status(400).json({ error: 'Já existe um saque pendente em análise.' });

  // Cria solicitação de saque + bloqueia o valor
  const [insertRes, updateRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/saques`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: user.id, valor: valorNum, chave_pix: chavePix, banco_nome: bancoNome || null, status: 'pendente' }),
    }),
    fetch(`${SUPABASE_URL}/rest/v1/saldos_profissionais?user_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ saldo_disponivel: saldoDisp - valorNum, saldo_retido: (Number(saldo?.saldo_retido || 0)) + valorNum }),
    }),
  ]);

  if (!insertRes.ok) {
    console.error('[solicitar-saque] erro insert:', await insertRes.text());
    return res.status(500).json({ error: 'Erro ao registrar solicitação' });
  }

  const [saque] = await insertRes.json();
  await auditLog({ acao: 'saque_solicitado', user_id: user.id, ip, detalhes: { valor: valorNum, saque_id: saque?.id }, sucesso: true });

  return res.status(200).json({ ok: true, mensagem: 'Solicitação registrada. O pagamento será processado em até 2 dias úteis.', saqueId: saque?.id });
}
