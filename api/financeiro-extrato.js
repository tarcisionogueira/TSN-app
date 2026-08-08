/**
 * /api/financeiro-extrato — EXTRATO REAL das contas da plataforma, unificado e classificado.
 *
 * PEDIDO DO DONO (08/08): "melhorar a tela dos que já temos integrados, para que traga o extrato
 * real da plataforma, assim como uma classificação do que está sendo investido, para podermos
 * ter uma tomada de decisão com base no fluxo financeiro. Podendo ser o extrato unificado ou
 * separado por tipo de banco."
 *
 * O QUE MUDA EM RELAÇÃO AO QUE JÁ EXISTIA: as telas de hoje mostram só o lado da RECEITA. O
 * `mp-admin?action=transacoes` inclusive DESCARTA de propósito tudo que não é receita — e é
 * justamente ali que moram as SAÍDAS (o próprio comentário daquele código cita "Anthropic" como
 * exemplo de compra da conta). Para decidir com base em fluxo de caixa é preciso os dois lados,
 * então aqui as saídas entram, classificadas.
 *
 * CLASSIFICAÇÃO: regras determinísticas sobre descrição/método/valor (sem IA, custo zero). Cada
 * lançamento sai com `categoria` e `direcao`. O que não casar com regra nenhuma vai para
 * 'nao_classificado' — visível de propósito: categoria inventada é pior que categoria ausente,
 * porque some do radar justamente o gasto novo que ninguém previu.
 *
 * FONTES: Asaas (recebimentos + transferências) e Mercado Pago (pagamentos, entradas e saídas).
 * Bancos (Inter, C6, Bradesco, Caixa) não entram aqui — dependem da integração de Open Finance
 * ainda não contratada. A resposta diz explicitamente quais contas foram lidas, para a tela não
 * dar a entender que o total é a posição consolidada da empresa.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { getUser, getUserRoleById, isCronAuthorized } from './_auth.js';
import { checkRateLimit, getIP } from './_rate-limit.js';

const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();
const MP_TOKEN  = (process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();

// ── Classificação ────────────────────────────────────────────────────────────────────────────
// Ordem IMPORTA: a primeira regra que casar vence. As mais específicas vêm antes.
const REGRAS = [
  { cat: 'ia_e_dados',    rx: /anthropic|claude|openai|gemini|google\s*cloud|bright\s*data|brightdata|serpapi|apify/i },
  { cat: 'infraestrutura',rx: /vercel|supabase|cloudflare|aws|amazon\s*web|github|render|railway|resend|twilio|daily\.co/i },
  { cat: 'marketing',     rx: /meta\s*ads|facebook|instagram|google\s*ads|tiktok|linkedin|mailchimp|rd\s*station/i },
  { cat: 'taxa_gateway',  rx: /taxa|tarifa|fee|comiss(ã|a)o\s*(do\s*)?(gateway|asaas|mercado)/i },
  { cat: 'saque_e_transferencia', rx: /transfer|saque|withdraw|pix\s*enviado|ted|doc\b/i },
  { cat: 'imposto',       rx: /imposto|das\b|simples\s*nacional|iss|irrf|darf/i },
  { cat: 'assinatura',    rx: /assinatura|plano|investidor\s*pro|clube|assessorad|mensalidade/i },
  { cat: 'credito_avulso',rx: /cr(é|e)dito|relat(ó|o)rio|avulso|pacote/i },
];
function classificar(descricao, direcao) {
  const t = String(descricao || '');
  for (const r of REGRAS) if (r.rx.test(t)) return r.cat;
  // Sem pista textual: a direção dá o mínimo honesto, sem inventar finalidade.
  return direcao === 'entrada' ? 'receita_nao_classificada' : 'nao_classificado';
}

const num = (v) => Number(v || 0);
const dia = (d) => (d ? String(d).slice(0, 10) : null);

async function asaas(path) {
  if (!ASAAS_KEY) return null;
  const r = await fetch(`${ASAAS_URL}${path}`, { headers: { access_token: ASAAS_KEY }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) { console.error('[financeiro] asaas', path, r.status); return null; }
  return r.json().catch(() => null);
}
async function mp(path) {
  if (!MP_TOKEN) return null;
  const r = await fetch(`https://api.mercadopago.com${path}`, { headers: { Authorization: `Bearer ${MP_TOKEN}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) { console.error('[financeiro] mp', path, r.status); return null; }
  return r.json().catch(() => null);
}

// ── Paginação ────────────────────────────────────────────────────────────────
// PEDIDO DO DONO (08/08): "não podem haver valores flutuantes, mas sim valores reais
// cobrados, recebidos e pagos". A causa de valor que muda sem motivo estava aqui: as
// três consultas pediam `limit=100` e paravam — sem `offset`, sem olhar `hasMore` nem
// `paging.total`. Passando de 100 lançamentos no período, o resto sumia EM SILÊNCIO, e
// o resumo (entradas/saídas/resultado) era somado sobre o pedaço que coube. Dois
// períodos diferentes não fechavam entre si, e a conciliação — que importa deste mesmo
// endpoint — herdava o extrato pela metade, levando o buraco para a DRE.
// Agora: pagina até acabar, com teto explícito. Se o teto for atingido, a resposta DIZ
// (`truncado`), porque total incompleto sem aviso é pior que total ausente.
const PAGINA = 100;
const MAX_PAGINAS = 30; // 3.000 lançamentos por fonte

async function asaasPaginado(base) {
  const itens = [];
  let truncado = false;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const j = await asaas(`${base}&limit=${PAGINA}&offset=${p * PAGINA}`);
    if (!j) break;
    const lote = j.data || [];
    itens.push(...lote);
    if (!j.hasMore || lote.length === 0) return { itens, truncado: false };
    if (p === MAX_PAGINAS - 1) truncado = true;
  }
  return { itens, truncado };
}

async function mpPaginado(base) {
  const itens = [];
  let truncado = false;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const j = await mp(`${base}&limit=${PAGINA}&offset=${p * PAGINA}`);
    if (!j) break;
    const lote = j.results || [];
    itens.push(...lote);
    const total = Number(j.paging?.total ?? 0);
    if (lote.length === 0 || itens.length >= total) return { itens, truncado: false };
    if (p === MAX_PAGINAS - 1) truncado = true;
  }
  return { itens, truncado };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }

  // Dado financeiro da empresa: só admin — OU o cron de sincronização, que traz o extrato para a
  // conciliação sozinho (senão a importação dependeria de alguém lembrar de apertar um botão).
  // O cron entra pelo CRON_SECRET, nunca por sessão, e só LÊ.
  const ehCron = isCronAuthorized(req);
  let user = null;
  if (!ehCron) {
    user = await getUser(req);
    if (!user?.id) { res.status(401).json({ error: 'Não autenticado' }); return; }
    const role = await getUserRoleById(user.id);
    if (role !== 'admin') { res.status(403).json({ error: 'Acesso restrito a administradores' }); return; }
    const rl = await checkRateLimit(`financeiro:${user.id}`, 30, 5 * 60_000);
    if (!rl.ok) { res.status(429).json({ error: 'Muitas consultas. Aguarde alguns minutos.' }); return; }
  }

  const url = new URL(req.url, 'http://localhost');
  const dias = Math.min(365, Math.max(7, Number(url.searchParams.get('dias')) || 90));
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const ate = new Date().toISOString().slice(0, 10);

  const lancamentos = [];
  const contas = [];
  const avisos = [];
  // Vira true se alguma fonte bateu o teto de paginação: a resposta precisa CONFESSAR
  // que o total não é o total, senão a tela mostra um número parcial com cara de real.
  let truncado = false;

  // ── ASAAS ──────────────────────────────────────────────────────────────────────────────────
  if (ASAAS_KEY) {
    const [saldo, recebidos, transfers] = await Promise.all([
      asaas('/finance/balance'),
      asaasPaginado(`/payments?status=RECEIVED&paymentDate[ge]=${desde}&paymentDate[le]=${ate}`),
      asaasPaginado(`/transfers?dateCreated[ge]=${desde}`),
    ]);
    contas.push({ banco: 'Asaas', tipo: 'gateway', saldo: saldo ? num(saldo.balance) : null, saldo_indisponivel: !saldo });
    if (!saldo) avisos.push('Não consegui ler o saldo do Asaas agora.');
    if (recebidos.truncado || transfers.truncado) {
      truncado = true;
      avisos.push(`Asaas: o período tem mais de ${MAX_PAGINAS * PAGINA} lançamentos e a leitura parou nesse teto — os totais abaixo estão INCOMPLETOS. Reduza o período.`);
    }
    if (!recebidos.itens.length && !transfers.itens.length) {
      avisos.push('O Asaas respondeu sem nenhum lançamento no período — confira se a ASAAS_API_KEY do ambiente é a da conta de produção.');
    }
    for (const p of recebidos.itens) {
      const desc = p.description || p.billingType || 'Recebimento Asaas';
      lancamentos.push({
        banco: 'Asaas', id: String(p.id), data: dia(p.paymentDate || p.confirmedDate || p.dateCreated),
        descricao: desc, direcao: 'entrada',
        bruto: num(p.value), liquido: num(p.netValue ?? p.value),
        taxa: Number((num(p.value) - num(p.netValue ?? p.value)).toFixed(2)),
        metodo: p.billingType || null, categoria: classificar(desc, 'entrada'),
      });
    }
    for (const t of transfers.itens) {
      const desc = t.description || `Transferência ${t.type || ''}`.trim();
      lancamentos.push({
        banco: 'Asaas', id: String(t.id), data: dia(t.dateCreated || t.effectiveDate),
        descricao: desc, direcao: 'saida',
        bruto: num(t.value), liquido: num(t.netValue ?? t.value),
        taxa: num(t.transferFee), metodo: t.type || null,
        categoria: classificar(desc || 'transferencia', 'saida') === 'nao_classificado'
          ? 'saque_e_transferencia' : classificar(desc || 'transferencia', 'saida'),
      });
    }
  } else {
    avisos.push('ASAAS_API_KEY não configurada — a conta Asaas ficou de fora.');
  }

  // ── MERCADO PAGO ───────────────────────────────────────────────────────────────────────────
  if (MP_TOKEN) {
    const me = await mp('/users/me');
    const meuId = me?.id != null ? String(me.id) : null;
    const bal = meuId ? await mp(`/users/${meuId}/mercadopago_account/balance`) : null;
    contas.push({
      banco: 'Mercado Pago', tipo: 'gateway',
      saldo: bal ? num(bal.available_balance ?? bal.available) : null,
      saldo_a_liberar: bal ? num(bal.unavailable_balance ?? bal.unavailable) : null,
      saldo_indisponivel: !bal,
    });
    if (!bal) avisos.push('O Mercado Pago não expõe o saldo desta conta pela API.');

    const busca = await mpPaginado(`/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${desde}T00:00:00.000-03:00&end_date=${ate}T23:59:59.999-03:00`);
    if (busca.truncado) {
      truncado = true;
      avisos.push(`Mercado Pago: o período tem mais de ${MAX_PAGINAS * PAGINA} lançamentos e a leitura parou nesse teto — os totais abaixo estão INCOMPLETOS. Reduza o período.`);
    }
    for (const p of busca.itens) {
      if (p.status !== 'approved') continue;
      const bruto = num(p.transaction_amount);
      const liquido = p.transaction_details?.net_received_amount != null ? num(p.transaction_details.net_received_amount) : null;
      const collector = p.collector_id ?? p.collector?.id ?? null;
      // Somos o RECEBEDOR → entrada. Senão, foi a conta que pagou → saída (é onde estão os
      // custos de IA, infraestrutura e anúncios pagos no cartão da empresa).
      const somosRecebedor = (meuId == null || collector == null) ? true : String(collector) === meuId;
      const direcao = somosRecebedor ? 'entrada' : 'saida';
      const desc = p.description || p.payment_method_id || 'Movimentação Mercado Pago';
      lancamentos.push({
        banco: 'Mercado Pago', id: String(p.id), data: dia(p.date_approved || p.date_created),
        descricao: desc, direcao,
        bruto, liquido: liquido ?? bruto,
        taxa: liquido != null ? Number(Math.max(0, bruto - liquido).toFixed(2)) : null,
        metodo: p.payment_method_id || null, categoria: classificar(desc, direcao),
      });
    }
  } else {
    avisos.push('Token do Mercado Pago não configurado — a conta ficou de fora.');
  }

  lancamentos.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  const somar = (fn) => lancamentos.filter(fn).reduce((s, l) => s + (l.liquido ?? l.bruto ?? 0), 0);
  const entradas = somar(l => l.direcao === 'entrada');
  const saidas = somar(l => l.direcao === 'saida');

  const porCategoria = {};
  for (const l of lancamentos) {
    const k = l.categoria;
    porCategoria[k] = porCategoria[k] || { categoria: k, direcao: l.direcao, total: 0, qtd: 0 };
    porCategoria[k].total = Number((porCategoria[k].total + (l.liquido ?? l.bruto ?? 0)).toFixed(2));
    porCategoria[k].qtd += 1;
  }
  const porBanco = {};
  for (const l of lancamentos) {
    const k = l.banco;
    porBanco[k] = porBanco[k] || { banco: k, entradas: 0, saidas: 0, qtd: 0 };
    porBanco[k][l.direcao === 'entrada' ? 'entradas' : 'saidas'] += (l.liquido ?? l.bruto ?? 0);
    porBanco[k].qtd += 1;
  }
  for (const b of Object.values(porBanco)) {
    b.entradas = Number(b.entradas.toFixed(2));
    b.saidas = Number(b.saidas.toFixed(2));
    b.resultado = Number((b.entradas - b.saidas).toFixed(2));
  }

  res.status(200).json({
    ok: true,
    periodo: { desde, ate, dias },
    // Deixa EXPLÍCITO o que foi lido: sem isto a tela sugere que o total é a posição da empresa,
    // quando os 4 bancos (Inter, C6, Bradesco, Caixa) ainda não estão integrados.
    contas,
    cobertura: 'Somente Asaas e Mercado Pago. Contas bancárias (Inter, C6, Bradesco, Caixa) ainda não integradas.',
    avisos,
    // `completo: false` = os totais NÃO fecham com a conta real. A tela deve dizer isso
    // ao lado do número, não escondê-lo.
    completo: !truncado,
    resumo: {
      entradas: Number(entradas.toFixed(2)),
      saidas: Number(saidas.toFixed(2)),
      resultado: Number((entradas - saidas).toFixed(2)),
      lancamentos: lancamentos.length,
      completo: !truncado,
    },
    por_banco: Object.values(porBanco),
    por_categoria: Object.values(porCategoria).sort((a, b) => b.total - a.total),
    // A LISTA vem cortada em 300 por peso de payload, mas os TOTAIS acima são somados
    // sobre todos os lançamentos lidos — `lancamentos_exibidos` × `resumo.lancamentos`
    // deixa isso explícito, para ninguém conferir a soma contando as linhas da tela.
    lancamentos_exibidos: Math.min(lancamentos.length, 300),
    lancamentos: lancamentos.slice(0, 300),
  });
}
