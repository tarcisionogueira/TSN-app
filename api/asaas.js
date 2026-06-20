// Define ASAAS_ENV=sandbox na Vercel para testar sem cobrar de verdade.
// Em produção (default) usa a URL real do Asaas.
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';
// .trim() remove espaços/quebras de linha acidentais ao colar a chave
const API_KEY = (process.env.ASAAS_API_KEY || '').trim();

// Fallback hardcoded caso o Supabase não retorne
const PLANOS_FALLBACK = {
  top1:              { nome: 'Investidor',                  valor: 49.90,    ciclo: 'MONTHLY', maxPayments: undefined },
  top2:              { nome: 'Investidor Pro',              valor: 99.90,    ciclo: 'MONTHLY', maxPayments: undefined },
  clube:             { nome: 'Clube de Negócios (Mensal)',  valor: 5000.00,  ciclo: 'MONTHLY', maxPayments: undefined },
  clube_vista:       { nome: 'Clube de Negócios (À Vista)', valor: 48000.00, avulso: true },
  assessorado:       { nome: 'Assessorado (12× R$ 500)',   valor: 500.00,   ciclo: 'MONTHLY', maxPayments: 12 },
  assessorado_vista: { nome: 'Assessorado (À Vista)',       valor: 5000.00,  avulso: true },
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
    const PLANOS = await getPlanosConfig();

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

      // 2. Cria cobrança — avulsa (à vista) ou assinatura recorrente
      const info = PLANOS[plano];
      let linkPagamento, subscriptionId;

      if (info.avulso) {
        // Pagamento único — sem renovação automática
        const cobranca = await asaasPost('/payments', {
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

      return res.status(200).json({
        subscriptionId,
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

    if (action === 'financas') {
      const hoje = new Date();
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().split('T')[0];
      const [balance, statsMes] = await Promise.all([
        asaasGet('/finances/balance'),
        asaasGet(`/finances/statistics?startDate=${inicioMes}&endDate=${fimMes}`),
      ]);
      return res.status(200).json({ balance, statsMes });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    console.error('Asaas error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
