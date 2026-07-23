import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';
import { alertarErro } from './_error-alert.js';
import { cpfDoRegistro } from './_cpf.js';

// CPF do usuário autenticado: decifra o cpf_enc do próprio perfil (não confia
// no CPF que veio do body). Fallback ao body só durante a transição da cifra.
async function cpfAutenticado(userId, cpfBody) {
  const fb = String(cpfBody || '').replace(/\D/g, '') || null;
  if (!userId) return fb;
  try {
    const r = await fetch(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/perfis?id=eq.${userId}&select=cpf,cpf_enc`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    if (!r.ok) return fb;
    const [row] = await r.json();
    return (await cpfDoRegistro(row)) || fb;
  } catch { return fb; }
}
// Define ASAAS_ENV=sandbox na Vercel para testar sem cobrar de verdade.
// Em produção (default) usa a URL real do Asaas.
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';
// .trim() remove espaços/quebras de linha acidentais ao colar a chave
const API_KEY = (process.env.ASAAS_API_KEY || '').trim();

// Fallback hardcoded caso o Supabase não retorne
const PLANOS_FALLBACK = {
  top2:              { nome: 'Investidor Pro',              valor: 49.90,    ciclo: 'MONTHLY', maxPayments: undefined },
  clube:             { nome: 'Clube de Negócios (Mensal)',  valor: 5000.00,  ciclo: 'MONTHLY', maxPayments: undefined },
  clube_vista:       { nome: 'Clube de Negócios (À Vista)', valor: 48000.00, avulso: true },
  assessorado:       { nome: 'Assessorado (12× R$ 500)',   valor: 500.00,   ciclo: 'MONTHLY', maxPayments: 12 },
  assessorado_vista: { nome: 'Assessorado (À Vista)',       valor: 4800.00,  avulso: true },
};

async function getPlanosConfig() {
  try {
    const res = await fetch(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/planos_config?select=plano_key,nome,preco,preco_vista&ativo=eq.true`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    if (!res.ok) return PLANOS_FALLBACK;
    const rows = await res.json();
    const cfg = {};
    for (const r of rows) {
      // mensal / assinatura
      cfg[r.plano_key] = {
        ...PLANOS_FALLBACK[r.plano_key],
        nome: r.nome,
        valor: Number(r.preco),
      };
      // variante à vista (assessorado_vista, clube_vista)
      if (r.preco_vista != null) {
        const key = `${r.plano_key}_vista`;
        cfg[key] = {
          ...PLANOS_FALLBACK[key],
          nome: `${r.nome} (À Vista)`,
          valor: Number(r.preco_vista),
        };
      }
    }
    return { ...PLANOS_FALLBACK, ...cfg };
  } catch {
    return PLANOS_FALLBACK;
  }
}

async function asaasPost(path, body) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'access_token': API_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.description || 'Erro Asaas');
  return data;
}

async function asaasGet(path) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    headers: { 'access_token': API_KEY },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Asaas retornou resposta inválida (${res.status})`); }
  if (!res.ok) throw new Error(data.errors?.[0]?.description || data.message || 'Erro Asaas');
  return data;
}

async function asaasPut(path, body) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'access_token': API_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.description || 'Erro Asaas');
  return data;
}

async function getAuthUserNode(req) {
  const auth = req.headers.authorization || req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'Chave do Asaas não configurada no servidor (ASAAS_API_KEY).' });
  }

  const ip = getIP(req);
  const rl = await checkRateLimit(`asaas:${ip}`, 20, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  // Ações do usuário exigem autenticação
  const { action, ...body } = req.body;
  const userActions = ['criar_assinatura', 'gerenciar_assinatura', 'criar_cobranca_avulsa', 'cancelar_assinatura', 'sync_customer'];
  let authUser = null;
  if (userActions.includes(action)) {
    authUser = await getAuthUserNode(req);
    if (!authUser?.id) return res.status(401).json({ error: 'Não autorizado' });
    const emailBody = body.email;
    if (emailBody && authUser.email !== emailBody) {
      auditLog({ acao: 'asaas_email_mismatch', user_id: authUser.id, ip, detalhes: { action }, sucesso: false });
      return res.status(403).json({ error: 'Email não corresponde ao usuário autenticado' });
    }
  }

  try {
    const PLANOS = await getPlanosConfig();

    if (action === 'criar_assinatura') {
      const { nome, email, plano } = body;
      if (!PLANOS[plano]) return res.status(400).json({ error: 'Plano inválido' });
      const cpf = await cpfAutenticado(authUser?.id, body.cpf);

      // 1. Cria ou recupera customer
      const searchRes = await fetch(`${ASAAS_URL}/customers?email=${encodeURIComponent(email)}`, {
        headers: { 'access_token': API_KEY },
      });
      // Sem checar .ok, um 4xx/5xx transitório na busca daria data vazio → o código criaria
      // um customer DUPLICADO no Asaas em vez de reusar o existente. Falha de busca ≠ inexistência.
      if (!searchRes.ok) throw new Error(`asaas_customer_search_${searchRes.status}`);
      const searchData = await searchRes.json();

      let customerId;
      if (searchData.data?.length > 0) {
        customerId = searchData.data[0].id;
      } else {
        const customer = await asaasPost('/customers', {
          name: nome,
          email,
          cpfCnpj: cpf?.replace(/\D/g, '') || undefined,
        });
        customerId = customer.id;
      }

      // 2. Cria cobrança — avulsa (à vista) ou assinatura recorrente
      const info = PLANOS[plano];
      let linkPagamento, subscriptionId;

      let cobranca;
      if (info.avulso) {
        // Pagamento único — sem renovação automática
        cobranca = await asaasPost('/payments', {
          customer: customerId,
          billingType: 'UNDEFINED',
          value: info.valor,
          dueDate: new Date().toISOString().split('T')[0],
          description: info.nome,
        });
        linkPagamento = cobranca.invoiceUrl || cobranca.bankSlipUrl;
      } else {
        // Assinatura recorrente
        const subscription = await asaasPost('/subscriptions', {
          customer: customerId,
          billingType: 'UNDEFINED',
          value: info.valor,
          nextDueDate: new Date().toISOString().split('T')[0],
          cycle: info.ciclo,
          description: info.nome,
          maxPayments: info.maxPayments || undefined,
        });
        subscriptionId = subscription.id;

        const invoices = await asaasGet(`/subscriptions/${subscription.id}/payments`);
        const primeiraFatura = invoices.data?.[0];
        linkPagamento = primeiraFatura?.invoiceUrl || primeiraFatura?.bankSlipUrl || null;
      }

      auditLog({ acao: 'assinatura_criada', user_id: authUser?.id, ip, detalhes: { plano, customerId, subscriptionId, avulso: !!info.avulso }, sucesso: true });
      return res.status(200).json({
        subscriptionId,
        paymentId: info.avulso ? cobranca?.id : undefined,
        customerId,
        linkPagamento,
        avulso: !!info.avulso,
      });
    }

    // ── Upgrade / Downgrade de plano ──
    if (action === 'gerenciar_assinatura') {
      const { email, plano } = body;
      const info = PLANOS[plano];
      if (!info || info.avulso) return res.status(400).json({ error: 'Plano inválido para gerenciamento de assinatura' });

      // Localiza customer e assinatura ativa
      const customers = await asaasGet(`/customers?email=${encodeURIComponent(email)}`);
      const customer = customers.data?.[0];
      if (!customer) return res.status(404).json({ error: 'Cliente não encontrado no Asaas. Faça a primeira assinatura.' });
      const subs = await asaasGet(`/subscriptions?customer=${customer.id}&status=ACTIVE`);
      const sub = subs.data?.[0];
      if (!sub) return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada. Crie uma assinatura primeiro.' });

      const valorAtual = Number(sub.value) || 0;
      const valorNovo = info.valor;
      const isUpgrade = valorNovo > valorAtual;

      // Atualiza a assinatura para o novo valor/plano.
      // Upgrade: aplica já (updatePendingPayments=true). Downgrade: mantém o ciclo
      // atual e só muda na próxima cobrança (updatePendingPayments=false).
      await asaasPut(`/subscriptions/${sub.id}`, {
        value: valorNovo,
        description: info.nome,
        updatePendingPayments: isUpgrade,
      });

      let linkPagamento = null;
      let cobrancaDiferenca = 0;
      if (isUpgrade) {
        // Cobra a diferença proporcional agora, mantendo o vencimento original na recorrência.
        cobrancaDiferenca = Number((valorNovo - valorAtual).toFixed(2));
        const cobranca = await asaasPost('/payments', {
          customer: customer.id,
          billingType: 'UNDEFINED',
          value: cobrancaDiferenca,
          dueDate: new Date().toISOString().split('T')[0],
          description: `Upgrade para ${info.nome} — diferença proporcional`,
        });
        linkPagamento = cobranca.invoiceUrl || cobranca.bankSlipUrl;
      }

      return res.status(200).json({
        tipo: isUpgrade ? 'upgrade' : 'downgrade',
        subscriptionId: sub.id,
        valorAnterior: valorAtual,
        valorNovo,
        cobrancaDiferenca,
        linkPagamento,
        proximoVencimento: sub.nextDueDate,
      });
    }

    // ── Cancelar assinatura (solicitado pelo próprio membro) ──
    if (action === 'cancelar_assinatura') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });

      const customers = await asaasGet(`/customers?email=${encodeURIComponent(email)}`);
      const customer = customers.data?.[0];
      if (!customer) return res.status(404).json({ error: 'Cliente não encontrado no Asaas.' });

      const subs = await asaasGet(`/subscriptions?customer=${customer.id}&status=ACTIVE`);
      const sub = subs.data?.[0];
      if (!sub) return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada.' });

      // Remove a assinatura no Asaas
      const delRes = await fetch(`${ASAAS_URL}/subscriptions/${sub.id}`, {
        method: 'DELETE',
        headers: { 'access_token': API_KEY },
      });
      if (!delRes.ok) {
        const t = await delRes.text();
        throw new Error(`Erro ao cancelar: ${t}`);
      }

      return res.status(200).json({
        cancelado: true,
        subscriptionId: sub.id,
        proximaCobranca: sub.nextDueDate,
      });
    }

    // ── Busca ou cria customer pelo CPF/email ──
    if (action === 'sync_customer') {
      const { nome, email } = body;
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });

      const cpfLimpo = await cpfAutenticado(authUser?.id, body.cpf);
      let customerId = null;

      // Tenta por CPF primeiro
      if (cpfLimpo) {
        const byCpf = await asaasGet(`/customers?cpfCnpj=${cpfLimpo}`);
        if (byCpf.data?.length > 0) customerId = byCpf.data[0].id;
      }

      // Tenta por email
      if (!customerId) {
        const byEmail = await asaasGet(`/customers?email=${encodeURIComponent(email)}`);
        if (byEmail.data?.length > 0) customerId = byEmail.data[0].id;
      }

      // Cria novo customer se não encontrou
      if (!customerId) {
        const customer = await asaasPost('/customers', {
          name: nome || email,
          email,
          cpfCnpj: cpfLimpo || undefined,
        });
        customerId = customer.id;
      }

      return res.status(200).json({ customerId });
    }

    // Ações financeiras exigem role admin
    if (['financas', 'extrato', 'transferir_pix'].includes(action)) {
      const adminUser = await getAuthUserNode(req);
      if (!adminUser?.id) return res.status(401).json({ error: 'Não autorizado' });
      const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
      const perfilRes = await fetch(`${SB_URL}/rest/v1/perfis?id=eq.${adminUser.id}&select=role&limit=1`, {
        headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}` },
      });
      const [perfil] = perfilRes.ok ? await perfilRes.json() : [];
      if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }

    if (action === 'financas') {
      const hoje = new Date();
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().split('T')[0];
      const [balance, statsMes] = await Promise.allSettled([
        asaasGet('/finance/balance'),
        asaasGet(`/finance/statistics?startDate=${inicioMes}&endDate=${fimMes}`),
      ]);
      if (balance.status === 'rejected') throw new Error(balance.reason?.message || 'Erro ao buscar saldo');
      return res.status(200).json({
        balance: balance.value,
        statsMes: statsMes.status === 'fulfilled' ? statsMes.value : null,
      });
    }

    if (action === 'extrato') {
      const hoje = new Date();
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().split('T')[0];
      const data = await asaasGet(`/payments?status=RECEIVED&paymentDate[ge]=${inicioMes}&paymentDate[le]=${fimMes}&limit=50`);
      return res.status(200).json(data);
    }

    if (action === 'transferir_pix') {
      const { chavePix, tipoChave, valor, descricao } = body;
      if (!chavePix || !valor) return res.status(400).json({ error: 'Chave PIX e valor são obrigatórios' });
      // Validação de valor: número > 0 e dentro de um teto configurável — evita que
      // uma sessão admin comprometida (ou CSRF) esvazie o saldo numa transferência.
      const valorNum = Number(valor);
      const tetoPix = Number(process.env.PIX_TRANSFER_MAX || 10000);
      if (!Number.isFinite(valorNum) || valorNum <= 0) return res.status(400).json({ error: 'Valor inválido' });
      if (valorNum > tetoPix) return res.status(400).json({ error: `Valor acima do teto por transferência (R$ ${tetoPix.toLocaleString('pt-BR')}). Ajuste PIX_TRANSFER_MAX se necessário.` });
      const data = await asaasPost('/transfers', {
        value: valorNum,
        pixAddressKey: chavePix,
        pixAddressKeyType: tipoChave || 'CPF',
        description: descricao || 'Transferência BidPro Brasil',
      });
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    console.error('Asaas error:', err.message);
    alertarErro({ rota: '/api/asaas', erro: err.message, extra: { action } });
    return res.status(500).json({ error: 'Erro interno no processamento' });
  }
}
