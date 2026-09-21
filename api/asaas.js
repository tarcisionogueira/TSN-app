import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';
import { alertarErro } from './_error-alert.js';
import { cpfDoRegistro, hashCpf, encryptCpf, cpfCriptoAtivo, validarCPF } from './_cpf.js';
import { podeContratarAssessoria } from './_assessoria.js';
import { logAtividade } from './_atividade.js';

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
  top2_anual:        { nome: 'Investidor Pro (Anual)',      valor: 449.90,   ciclo: 'YEARLY',  maxPayments: undefined }, // recorrente anual (renova = regra c)
  clube:             { nome: 'Clube de Negócios (Mensal)',  valor: 5000.00,  ciclo: 'MONTHLY', maxPayments: undefined },
  clube_vista:       { nome: 'Clube de Negócios (À Vista)', valor: 48000.00, avulso: true },
  assessorado:       { nome: 'Assessorado (12× R$ 500)',   valor: 500.00,   ciclo: 'MONTHLY', maxPayments: 12 },
  assessorado_vista: { nome: 'Assessorado (À Vista)',       valor: 4800.00,  avulso: true },
};

async function getPlanosConfig() {
  try {
    const res = await fetch(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/planos_config?select=plano_key,nome,preco,preco_vista,preco_anual&ativo=eq.true`,
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
      // variante ANUAL RECORRENTE (top2_anual): cycle YEARLY, renova indefinido (regra c).
      if (r.preco_anual != null) {
        const key = `${r.plano_key}_anual`;
        cfg[key] = {
          ...PLANOS_FALLBACK[key],
          nome: `${r.nome} (Anual)`,
          valor: Number(r.preco_anual),
          ciclo: 'YEARLY',
          maxPayments: undefined,
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
    // ── Fallback de gateway (18/09, pedido do dono): Asaas TRANSPARENTE quando o MP recusa
    // o cartão em honorário/cobrança avulsa — mesmo modelo já usado em Checkout.jsx pra
    // assinatura de plano ("Continuar pelo Asaas" com 1 clique), estendido aqui pros dois
    // fluxos SEM LOGIN (a posse do link — arrematacao_id/cobranca_id imprevisível — é a
    // credencial, mesmo modelo de api/mp-checkout.js). Preço SEMPRE recalculado aqui, nunca
    // aceito do corpo da requisição. `externalReference` segue a MESMA convenção de
    // `servico|`/`[servico]` já usada no webhook: `honorario|<arrematacao_id>` e
    // `cobranca_avulsa|<cobranca_id>` — api/asaas-webhook.js reconhece os dois e credita
    // honorarios_recebimentos/cobrancas_avulsas automaticamente (mesma lógica de
    // api/mp-webhook.js), sem depender de alguém dar baixa manual.
    if (action === 'criar_cobranca_fallback') {
      const { proposito: propFallback, arrematacao_id, cobranca_id, nome, email, cpf: cpfBody, endereco } = body;
      if (!email) return res.status(400).json({ error: 'email obrigatório' });
      // 18/09, pedido do dono: pagamento exige endereço completo (dados pra emissão de NF),
      // não só CPF. Mesma checagem de completude do Checkout.jsx (enderecoOk).
      const end = endereco || {};
      const enderecoOk = !!(end.cep && end.logradouro && end.numero && end.bairro && end.cidade && end.uf);
      if (!enderecoOk) return res.status(400).json({ error: 'endereco_necessario', mensagem: 'Informe o endereço completo (CEP, logradouro, número, bairro, cidade e UF) para gerar a cobrança.' });
      const SB = process.env.VITE_SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY;
      let saldo, descricao, externalReference, arrematanteId = null;

      if (propFallback === 'honorario_exito') {
        if (!arrematacao_id) return res.status(400).json({ error: 'arrematacao_id obrigatório' });
        const r = await fetch(`${SB}/rest/v1/arrematacoes?id=eq.${encodeURIComponent(arrematacao_id)}&select=id,arrematante_id,honorarios_valor,honorarios_status`, {
          headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }, signal: AbortSignal.timeout(10000),
        });
        const [arr] = r.ok ? await r.json().catch(() => []) : [];
        if (!arr) return res.status(404).json({ error: 'Arrematação não encontrada.' });
        if (['pago', 'distribuido'].includes(arr.honorarios_status)) return res.status(409).json({ error: 'Os honorários desta arrematação já foram pagos.' });
        const total = Number(arr.honorarios_valor) || 0;
        if (total <= 0) return res.status(400).json({ error: 'Honorários ainda não calculados para esta arrematação.' });
        const recR = await fetch(`${SB}/rest/v1/honorarios_recebimentos?arrematacao_id=eq.${encodeURIComponent(arrematacao_id)}&status=eq.confirmado&select=valor`, {
          headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }, signal: AbortSignal.timeout(10000),
        });
        const confirmados = recR.ok ? await recR.json().catch(() => []) : [];
        const jaRecebido = confirmados.reduce((s, x) => s + Number(x.valor || 0), 0);
        saldo = Math.round((total - jaRecebido) * 100) / 100;
        if (saldo <= 0) return res.status(409).json({ error: 'Os honorários desta arrematação já foram cobertos por outros recebimentos.' });
        descricao = 'Honorários de êxito (saldo restante) — BidPro Brasil';
        externalReference = `honorario|${arr.id}`;
        arrematanteId = arr.arrematante_id;
      } else if (propFallback === 'cobranca_avulsa') {
        if (!cobranca_id) return res.status(400).json({ error: 'cobranca_id obrigatório' });
        const r = await fetch(`${SB}/rest/v1/cobrancas_avulsas?id=eq.${encodeURIComponent(cobranca_id)}&select=id,descricao,valor,valor_pago_pix,status`, {
          headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }, signal: AbortSignal.timeout(10000),
        });
        const [cob] = r.ok ? await r.json().catch(() => []) : [];
        if (!cob) return res.status(404).json({ error: 'Cobrança não encontrada.' });
        if (cob.status !== 'aberta') return res.status(409).json({ error: 'Esta cobrança já foi paga ou cancelada.' });
        const total = Number(cob.valor) || 0;
        if (total <= 0) return res.status(400).json({ error: 'Cobrança sem valor válido.' });
        const jaPagoPix = Number(cob.valor_pago_pix) || 0;
        saldo = Math.round((total - jaPagoPix) * 100) / 100;
        if (saldo <= 0) return res.status(409).json({ error: 'Esta cobrança já foi coberta.' });
        descricao = String(cob.descricao || 'Cobrança avulsa — BidPro Brasil').slice(0, 250);
        externalReference = `cobranca_avulsa|${cob.id}`;
      } else {
        return res.status(400).json({ error: 'proposito inválido para fallback (honorario_exito ou cobranca_avulsa)' });
      }

      // O Asaas EXIGE cpfCnpj pra criar a cobrança. Tenta o cadastro do arrematante primeiro
      // (quando há um, ex.: honorário); a tela também pode enviar o CPF direto — cliente sem
      // verificação de identidade não tem CPF cadastrado, e sem este fallback o link nunca
      // conseguiria cobrar dele (achado real, 17/09).
      const cpfCadastro = arrematanteId ? await cpfAutenticado(arrematanteId, null) : null;
      const cpf = cpfCadastro || String(cpfBody || '').replace(/\D/g, '');
      if (!cpf || !validarCPF(cpf)) return res.status(400).json({ error: 'cpf_necessario', mensagem: 'Informe um CPF válido — o Asaas exige pra gerar a cobrança.' });

      // 18/09, pedido do dono: quem paga tem o cadastro atualizado com o que digitou aqui,
      // pra não precisar redigitar em cobranças futuras. `honorario_exito` já sabe o
      // arrematante_id; `cobranca_avulsa` não tem esse vínculo na tabela (é uma cobrança
      // por e-mail, pode nem ter conta) — tenta achar a conta pelo e-mail, best-effort.
      let perfilAlvoId = arrematanteId;
      if (!perfilAlvoId) {
        try {
          const adminRes = await fetch(`${SB}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
            headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }, signal: AbortSignal.timeout(8000),
          });
          if (adminRes.ok) {
            const adminData = await adminRes.json().catch(() => null);
            perfilAlvoId = adminData?.users?.[0]?.id || null;
          }
        } catch { /* padrao-ok: best-effort — sem conta encontrada, só não atualiza cadastro; a cobrança segue */ }
      }
      if (perfilAlvoId) {
        try {
          const enderecoFmt = [
            [end.logradouro, end.numero].filter(Boolean).join(', '),
            end.complemento, end.bairro,
            [end.cidade, end.uf].filter(Boolean).join(' - '),
            end.cep ? `CEP ${end.cep}` : '',
          ].filter(Boolean).join(' · ');
          const [cpf_hash, cpf_enc] = cpfCriptoAtivo() ? await Promise.all([hashCpf(cpf), encryptCpf(cpf)]) : [null, null];
          const patchRes = await fetch(`${SB}/rest/v1/perfis?id=eq.${encodeURIComponent(perfilAlvoId)}`, {
            method: 'PATCH',
            headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              endereco: enderecoFmt || null, endereco_cep: end.cep || null, endereco_logradouro: end.logradouro || null,
              endereco_numero: end.numero || null, endereco_complemento: end.complemento || null, endereco_bairro: end.bairro || null,
              endereco_cidade: end.cidade || null, endereco_uf: end.uf || null,
              ...(cpfCadastro ? {} : { cpf: null, cpf_hash, cpf_enc }), // não sobrescreve CPF já cadastrado antes (cpfCadastro veio de lá)
            }),
          });
          if (!patchRes.ok) console.error('[asaas fallback] atualizar cadastro falhou:', patchRes.status, await patchRes.text().catch(() => ''));
        } catch (e) { console.error('[asaas fallback] atualizar cadastro:', e?.message || e); } // padrao-ok: best-effort — não pode travar a cobrança por falha de atualização de cadastro
      }

      const searchRes = await fetch(`${ASAAS_URL}/customers?email=${encodeURIComponent(email)}`, { headers: { 'access_token': API_KEY } });
      if (!searchRes.ok) throw new Error(`asaas_customer_search_${searchRes.status}`);
      const searchData = await searchRes.json();
      const existente = searchData.data?.[0];
      let customerId = existente?.id;
      if (!customerId) {
        const customer = await asaasPost('/customers', { name: nome || email, email, cpfCnpj: cpf });
        customerId = customer.id;
      } else if (!existente.cpfCnpj) {
        // Cliente já existia no Asaas sem CPF (ex.: cadastro antigo, ou o customer criado
        // numa tentativa anterior a esta cobrança exigir o campo) — sem atualizar, o Asaas
        // segue recusando a cobrança pra sempre, mesmo com o CPF certo vindo agora.
        await asaasPut(`/customers/${customerId}`, { cpfCnpj: cpf });
      }
      const cobranca = await asaasPost('/payments', {
        customer: customerId,
        billingType: 'UNDEFINED',
        value: saldo,
        dueDate: new Date().toISOString().split('T')[0],
        description: descricao,
        externalReference,
      });
      auditLog({ acao: 'asaas_cobranca_fallback', user_id: null, ip, detalhes: { proposito: propFallback, arrematacao_id, cobranca_id, saldo, customerId }, sucesso: true });
      return res.status(200).json({ linkPagamento: cobranca.invoiceUrl || cobranca.bankSlipUrl, paymentId: cobranca.id, valor: saldo });
    }

    const PLANOS = await getPlanosConfig();

    if (action === 'criar_assinatura') {
      const { nome, email, plano } = body;
      if (!PLANOS[plano]) return res.status(400).json({ error: 'Plano inválido' });
      // GATE "1 assessoria por vez" no SERVIDOR (mesma regra do mp.js / assessoria-status).
      if (/^assessorado/.test(String(plano || '')) && authUser?.id) {
        try {
          const rp = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/perfis?id=eq.${authUser.id}&select=role`, { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
          const [pr] = rp.ok ? await rp.json() : [];
          const gate = await podeContratarAssessoria({ userId: authUser.id, email: authUser.email || email, role: pr?.role || null });
          if (!gate.podeContratar) return res.status(409).json({ error: 'assessoria_bloqueada', motivo: gate.motivo });
        } catch { /* falha na checagem não deve travar pagamento legítimo (fail-open de infra) */ }
      }
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

    // ── Compra AVULSA de produto (ebook/curso) — pagamento ÚNICO hospedado no Asaas ──
    // Fluxo do dono: parceiro vende o produto individual (link ?ref=CÓDIGO). O comprador
    // ganha só o PRODUTO (sem assinar). A cobrança leva externalReference = compras_produtos.id
    // p/ o webhook casar e ativar (confirmar_compra_produto) + creditar comissão do parceiro.
    if (action === 'criar_cobranca_avulsa') {
      const { produto_tipo, produto_id, ref, nome, email } = body;
      if (!['ebook', 'curso'].includes(produto_tipo) || !produto_id) {
        return res.status(400).json({ error: 'Produto inválido' });
      }
      const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const SVC = process.env.SUPABASE_SERVICE_KEY;
      // 1) Inicia a compra (valida ativo+pago, barra quem já tem acesso, grava parceiro/%, cria 'pendente')
      const iniRes = await fetch(`${SB}/rest/v1/rpc/comprar_produto_iniciar`, {
        method: 'POST',
        headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
        // Order bump: a tela manda QUAIS extras; a RPC valida e precifica cada um pelo cadastro.
        body: JSON.stringify({ p_user_id: authUser.id, p_produto_tipo: produto_tipo, p_produto_id: produto_id, p_ref: ref || null, p_extras: Array.isArray(body.extras) ? body.extras : [] }),
      });
      const ini = iniRes.ok ? await iniRes.json() : null;
      if (!ini?.ok) return res.status(400).json({ error: ini?.erro || 'nao_iniciado' });
      if (ini.ja_tem) return res.status(200).json({ ja_tem: true });

      // 2) Customer Asaas (reusa por email; falha de busca ≠ inexistência)
      const cpf = await cpfAutenticado(authUser.id, body.cpf);
      const searchRes = await fetch(`${ASAAS_URL}/customers?email=${encodeURIComponent(email)}`, { headers: { 'access_token': API_KEY } });
      if (!searchRes.ok) throw new Error(`asaas_customer_search_${searchRes.status}`);
      const searchData = await searchRes.json();
      let customerId = searchData.data?.[0]?.id;
      if (!customerId) {
        const customer = await asaasPost('/customers', { name: nome || email, email, cpfCnpj: cpf?.replace(/\D/g, '') || undefined });
        customerId = customer.id;
      }

      // 3) Cobrança ÚNICA marcada com o compra_id → o webhook ativa e credita a comissão
      const cobranca = await asaasPost('/payments', {
        customer: customerId,
        billingType: 'UNDEFINED',
        value: Number(ini.valor),
        dueDate: new Date().toISOString().split('T')[0],
        description: String(ini.titulo || 'Produto BidPro').slice(0, 120),
        externalReference: ini.compra_id,
      });
      auditLog({ acao: 'compra_produto_iniciada', user_id: authUser.id, ip, detalhes: { produto_tipo, produto_id, compra_id: ini.compra_id, customerId }, sucesso: true });
      return res.status(200).json({ linkPagamento: cobranca.invoiceUrl || cobranca.bankSlipUrl, paymentId: cobranca.id, compra_id: ini.compra_id, valor: ini.valor });
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

      if (authUser?.id) await logAtividade(authUser.id, 'assinatura_cancelada', 'assinatura Asaas', { gateway: 'asaas', subscriptionId: sub.id });

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

    // Ações financeiras exigem role admin. `adminUser` é declarado FORA do bloco (não
    // `const` dentro do `if`) porque `transferir_pix`, mais abaixo, também precisa dele
    // pra registrar quem pediu a transferência — escopo de bloco derrubaria isso em
    // ReferenceError em runtime (só apareceria no primeiro saque de verdade).
    let adminUser = null;
    if (['financas', 'extrato', 'transferir_pix', 'simular_antecipacao', 'solicitar_antecipacao'].includes(action)) {
      adminUser = await getAuthUserNode(req);
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
      // 90 dias cobre folgado o D+32 do cartão sem a janela crescer sem limite — "a receber"
      // é o que ainda NÃO virou saldo, não um recorte do mês corrente.
      const inicioJanela90 = new Date(hoje.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      // 18/09, achado com dado real (pagamento do Marcos, R$33.001,09, cartão, CONFIRMED):
      // `/finance/balance` só devolve `{balance}` — NÃO existe `totalReceivable` na resposta
      // real do Asaas (log de diagnóstico confirmou o objeto cru). E `/finance/statistics`
      // devolve 404 (endpoint indisponível nesta conta) — as duas causas do "zerado" que a
      // seção anterior deste HANDOFF só suspeitava. Trocado por cálculo sobre `/payments`, que
      // já prova funcionar (200, dado real): "a receber" = soma de CONFIRMED ainda não
      // liberado; "recebido no mês"/"taxas" = soma de RECEIVED+CONFIRMED do mês (value/netValue).
      // Limite de paginação (100) é honesto pro volume atual; se crescer, precisa paginar.
      const [balance, doMes, pendentes] = await Promise.allSettled([
        asaasGet('/finance/balance'),
        asaasGet(`/payments?dateCreated[ge]=${inicioMes}&dateCreated[le]=${fimMes}&limit=100`),
        asaasGet(`/payments?status=CONFIRMED&dateCreated[ge]=${inicioJanela90}&limit=100`),
      ]);
      if (balance.status === 'rejected') throw new Error(balance.reason?.message || 'Erro ao buscar saldo');

      const listaMes = doMes.status === 'fulfilled' ? (doMes.value?.data || []) : [];
      const recebidosMes = listaMes.filter(p => p.status === 'RECEIVED' || p.status === 'CONFIRMED');
      const revenue = recebidosMes.reduce((s, p) => s + (Number(p.value) || 0), 0);
      const fees = recebidosMes.reduce((s, p) => s + (p.netValue != null ? (Number(p.value) || 0) - Number(p.netValue) : 0), 0);

      const listaPendente = pendentes.status === 'fulfilled' ? (pendentes.value?.data || []) : [];
      const totalReceivable = listaPendente.reduce((s, p) => s + (Number(p.value) || 0), 0);

      return res.status(200).json({
        balance: { ...balance.value, totalReceivable },
        statsMes: { revenue, fees },
      });
    }

    if (action === 'extrato') {
      const hoje = new Date();
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().split('T')[0];
      // 18/09, achado com dado real: pagamento de CARTÃO fica `CONFIRMED` até liberar (D+32) e
      // `paymentDate` vem null até lá — filtrar só RECEIVED + paymentDate escondia qualquer
      // cobrança de cartão ainda não liquidada (foi exatamente o caso do Marcos: 0 resultados
      // com o filtro antigo, 1 com CONFIRMED via dateCreated). Filtra por `dateCreated` (quando
      // a cobrança nasceu) e inclui os dois status que representam dinheiro cobrado de verdade.
      const bruto = await asaasGet(`/payments?dateCreated[ge]=${inicioMes}&dateCreated[le]=${fimMes}&limit=100`);
      const filtrada = (bruto?.data || []).filter(p => p.status === 'RECEIVED' || p.status === 'CONFIRMED');
      return res.status(200).json({ ...bruto, data: filtrada, totalCount: filtrada.length });
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
      // Registra ANTES da validação por Webhook chegar (~5s depois, do lado do Asaas) —
      // é contra ESTE registro que api/asaas-validar-saque.js compara o payload recebido.
      // Sem isso, "validar" seria só responder aprovado pra qualquer coisa que chegasse.
      // Best-effort: se a gravação falhar, a validação por webhook vai recusar por não
      // achar o registro (fail-closed) — nunca aprova sem ter o que comparar.
      if (data?.id) {
        try {
          await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/asaas_transferencias_pendentes`, {
            method: 'POST',
            headers: {
              apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json', Prefer: 'return=minimal',
            },
            body: JSON.stringify({ asaas_transfer_id: data.id, valor: valorNum, chave_pix: chavePix, criado_por: adminUser.id }),
          });
        } catch { /* best-effort — fail-closed no validador cobre a ausência */ }
      }
      return res.status(200).json(data);
    }

    // ── ANTECIPAÇÃO DE RECEBÍVEL (18/09) ────────────────────────────────────────
    // Pedido do dono: verificar se dá pra liberar o valor de um recebível antes do
    // prazo padrão (D+32 no Asaas) e deixar essa opção disponível no sistema.
    // ⚠️ NÃO TESTADO CONTRA PRODUÇÃO — confirmei que a rota EXISTE de verdade
    // (POST/GET em /v3/anticipations[/simulate] respondem 401, não 404, sem
    // credencial — checado ao vivo via GitHub Actions, já que este ambiente não
    // alcança docs.asaas.com nem tem a chave de produção), mas não consegui abrir
    // a documentação (SPA renderizada em JS) pra confirmar o nome exato dos campos.
    // O nome usado abaixo (`payment`) segue a convenção do restante da API Asaas
    // (camelCase, singular). Qualquer campo errado volta como `errors[].description`
    // — ERRO ALTO E CLARO pro admin, nunca silencioso — mas ANTES de usar pra
    // valer, rode `simular_antecipacao` uma vez com um pagamento real e confira a
    // resposta manualmente.
    if (action === 'simular_antecipacao') {
      const { paymentId } = body;
      if (!paymentId) return res.status(400).json({ error: 'paymentId obrigatório (id do pagamento/recebível no Asaas)' });
      const data = await asaasGet(`/anticipations/simulate?payment=${encodeURIComponent(paymentId)}`);
      return res.status(200).json(data);
    }

    if (action === 'solicitar_antecipacao') {
      const { paymentId } = body;
      if (!paymentId) return res.status(400).json({ error: 'paymentId obrigatório (id do pagamento/recebível no Asaas)' });
      const data = await asaasPost('/anticipations', { payment: paymentId });
      // LOG DE ATIVIDADE (Cliente 360) — best-effort. Só alguns pagamentos têm vínculo local
      // com um usuário (honorário de êxito, via arrematacoes.arrematante_id); um link gerado
      // manualmente fora do fluxo do app (ver HANDOFF, achado do pagamento do Marcos) não tem
      // esse vínculo e o log simplesmente não acontece — silencioso, não é um erro.
      try {
        const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const KEY = process.env.SUPABASE_SERVICE_KEY;
        const r = await fetch(`${SB}/rest/v1/honorarios_recebimentos?gateway_payment_id=eq.${encodeURIComponent(paymentId)}&select=arrematacao_id&limit=1`, {
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
        });
        const [rec] = r.ok ? await r.json() : [];
        if (rec?.arrematacao_id) {
          const r2 = await fetch(`${SB}/rest/v1/arrematacoes?id=eq.${rec.arrematacao_id}&select=arrematante_id`, {
            headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
          });
          const [arr] = r2.ok ? await r2.json() : [];
          if (arr?.arrematante_id) await logAtividade(arr.arrematante_id, 'antecipacao_solicitada', `R$ ${data?.netValue ?? ''} líquido`, { paymentId, bruto: data?.value, taxa: data?.fee });
        }
      } catch { /* log é best-effort */ }
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    console.error('Asaas error:', err.message);
    alertarErro({ rota: '/api/asaas', erro: err.message, extra: { action } });
    // O motivo real (ex.: `errors[].description` do Asaas, já extraído por asaasGet/asaasPost)
    // ia só pro Sentry — que está DORMENTE até SENTRY_DSN existir (docs/ENVS_VERCEL.md, ainda
    // pendente) — e pro e-mail de alerta. O admin ficava só com "Erro interno no processamento",
    // sem NENHUMA pista, justamente nas ações (simular/solicitar antecipação) que o próprio
    // comentário pediu pra "conferir a resposta manualmente" antes de confiar. Toda ação aqui já
    // passou pelo gate de admin/dono-do-recurso lá em cima — o texto vem do Asaas, não é stack
    // trace nem segredo interno, então é seguro devolver pro admin.
    return res.status(500).json({ error: err.message || 'Erro interno no processamento' });
  }
}
