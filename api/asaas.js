// Define ASAAS_ENV=sandbox na Vercel para testar sem cobrar de verdade.
// Em produção (default) usa a URL real do Asaas.
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';
// .trim() remove espaços/quebras de linha acidentais ao colar a chave
const API_KEY = (process.env.ASAAS_API_KEY || '').trim();

const PLANOS = {
  top1:  { nome: 'Plano TOP 1', valor: 49.90, ciclo: 'MONTHLY' },
  top2:  { nome: 'Plano TOP 2', valor: 99.90, ciclo: 'MONTHLY' },
  clube: { nome: 'Clube de Negócios', valor: 5000.00, ciclo: 'MONTHLY' },
};

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
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.description || 'Erro Asaas');
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'Chave do Asaas não configurada no servidor (ASAAS_API_KEY).' });
  }

  const { action, ...body } = req.body;

  try {
    if (action === 'criar_assinatura') {
      const { nome, email, cpf, plano } = body;
      if (!PLANOS[plano]) return res.status(400).json({ error: 'Plano inválido' });

      // 1. Cria ou recupera customer
      const searchRes = await fetch(`${ASAAS_URL}/customers?email=${encodeURIComponent(email)}`, {
        headers: { 'access_token': API_KEY },
      });
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

      // 2. Cria assinatura
      const info = PLANOS[plano];
      const subscription = await asaasPost('/subscriptions', {
        customer: customerId,
        billingType: 'UNDEFINED', // usuário escolhe PIX, boleto ou cartão
        value: info.valor,
        nextDueDate: new Date().toISOString().split('T')[0],
        cycle: info.ciclo,
        description: info.nome,
        maxPayments: undefined, // recorrente sem fim
      });

      // 3. Pega link de pagamento da primeira fatura
      const invoices = await asaasGet(`/subscriptions/${subscription.id}/payments`);
      const primeiraFatura = invoices.data?.[0];
      const linkPagamento = primeiraFatura?.invoiceUrl || primeiraFatura?.bankSlipUrl;

      return res.status(200).json({
        subscriptionId: subscription.id,
        customerId,
        linkPagamento,
        status: subscription.status,
      });
    }

    // ── Upgrade / Downgrade de plano ──
    if (action === 'gerenciar_assinatura') {
      const { email, plano } = body;
      const info = PLANOS[plano];
      if (!info) return res.status(400).json({ error: 'Plano inválido' });

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

    // ── Busca ou cria customer pelo CPF/email ──
    if (action === 'sync_customer') {
      const { nome, email, cpf } = body;
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });

      const cpfLimpo = (cpf || '').replace(/\D/g, '');
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

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    console.error('Asaas error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
