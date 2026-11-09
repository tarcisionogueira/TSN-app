/**
 * POST /api/cobranca-avulsa-criar
 * Admin cria uma cobrança avulsa (motivo + valor livres, fora do catálogo fechado de
 * PROPOSITOS de api/mp-checkout.js) e recebe de volta o link público pra mandar ao
 * cliente/terceiro. Preço nasce AQUI, gravado no banco — api/mp-checkout.js e o webhook
 * sempre leem de `cobrancas_avulsas`, nunca aceitam valor vindo do pagador.
 */
import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, getIP } from './_rate-limit.js';
import { auditLog } from './_audit.js';
import { pedidoRepetido, CORPO_REPETIDO } from './_pedido-unico.js';
import { efeitoDoProduto } from '../src/lib/cobranca-produto.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (await pedidoRepetido(req, 'cobranca-avulsa-criar')) { res.status(409).json(CORPO_REPETIDO); return; } // comando repetido pela rede/navegador (30/10)
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIP(req);
  const rl = await checkRateLimit(`cobranca-avulsa-criar:${ip}`, 10, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas. Aguarde.' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Só admin cria cobrança avulsa.' });

  const { descricao, valor, destinatario_nome, destinatario_email, produto_key, quantidade, parcelas_max, parcelas_sem_juros } = req.body || {};
  const desc = String(descricao || '').trim();
  const v = Number(valor);
  if (desc.length < 5) return res.status(400).json({ error: 'Descrição obrigatória (mín. 5 caracteres) — explique o motivo da cobrança.' });
  if (!(v > 0)) return res.status(400).json({ error: 'Valor deve ser maior que zero.' });
  // PARCELAMENTO DESTA NEGOCIAÇÃO (07/11, dono): até quantas parcelas e até quantas sem juros. Padrão = 12 parcelas,
  // cliente assume os juros a partir da 2ª (sem juros até 1×). A conta dos juros é a de src/utils/parcelamento.js.
  const pMax = Math.max(1, Math.min(12, Math.floor(Number(parcelas_max) || 12)));
  // 07/11 (dono): "ao gerar, perguntar se absorve ou repassa os juros" — parcelado exige a escolha explícita.
  const juros = req.body?.juros;
  if (pMax > 1 && !['absorve', 'repassa'].includes(juros)) return res.status(400).json({ error: 'Escolha quem paga os juros do parcelado: o cliente (repassa) ou a BidPro (absorve).' });
  const pSemJuros = juros === 'absorve' ? Math.max(2, Math.min(pMax, Math.floor(Number(parcelas_sem_juros) || pMax))) : 1;
  const qtd = Math.max(1, Math.min(100, Math.floor(Number(quantidade) || 1)));
  const produto = produto_key ? String(produto_key).replace(/[^a-z0-9_]/gi, '').slice(0, 40) || null : null;
  // 08/11: produto de plano ativa na conta deste e-mail quando o link for pago. Sem ele, não há em quem ativar.
  if (efeitoDoProduto(produto) && !String(destinatario_email || '').includes('@')) return res.status(400).json({ error: 'Informe o e-mail da conta do cliente: o plano é ativado nela quando o link for pago.' });

  try {
    const ins = await fetch(`${SB_URL}/rest/v1/cobrancas_avulsas`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        descricao: desc.slice(0, 500), valor: v,
        destinatario_nome: destinatario_nome ? String(destinatario_nome).slice(0, 200) : null,
        destinatario_email: destinatario_email ? String(destinatario_email).slice(0, 200) : null,
        criado_por: user.id,
        parcelas_max: pMax, parcelas_sem_juros: pSemJuros, produto_key: produto, quantidade: qtd,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!ins.ok) {
      const detalhe = await ins.json().catch(() => null);
      return res.status(500).json({ error: detalhe?.message || 'Não foi possível criar a cobrança.' });
    }
    const [criada] = await ins.json();
    await auditLog({ acao: 'cobranca_avulsa_criada', user_id: user.id, ip, detalhes: { id: criada.id, valor: v, descricao: desc, produto, quantidade: qtd, parcelas_max: pMax, parcelas_sem_juros: pSemJuros }, sucesso: true });
    const base = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
    return res.status(200).json({ ok: true, cobranca: criada, link: `${base}/#/cobranca/${criada.id}` });
  } catch (e) {
    console.error('[cobranca-avulsa-criar]', e?.message || e);
    return res.status(500).json({ error: 'Erro interno ao criar cobrança.' });
  }
}
