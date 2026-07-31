/**
 * POST /api/ativar-pro-anual
 * Ativa o Investidor Pro ANUAL a partir de um PIX à vista (pagamento ÚNICO de 12 meses,
 * sem recorrência — PIX não debita sozinho). Chamado pelo frontend quando o PIX-anuidade
 * é confirmado.
 *
 * SEGURANÇA (dinheiro/acesso — "pagamento único que libera plano" é onde um bug vira Pro
 * grátis): a ativação NUNCA confia no cliente. Confere no Mercado Pago que o pagamento:
 *   1) está APROVADO,
 *   2) é do PRÓPRIO usuário autenticado (metadata.user_id),
 *   3) tem propósito 'plano_anual' (setado no mp-checkout),
 *   4) tem VALOR = preço anual vindo do SERVIDOR (planos_config), não do cliente.
 * Idempotente por paymentId (um pagamento ativa uma vez). Sem preapproval → o loop
 * ANUAL VENCIDO do reconciliar-cron rebaixa quando plano_vencimento passa (sem mandato ativo).
 */
import { getUser } from './_auth.js';
import { checkRateLimit, getIP } from './_rate-limit.js';
import { ativarPlanoDireto, eventoJaProcessado, removerEventoProcessado } from './_webhook-core.js';
import { auditLog } from './_audit.js';

const MP_BASE = 'https://api.mercadopago.com';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_SVC = process.env.SUPABASE_SERVICE_KEY;
const PRECO_ANUAL_FALLBACK = 449.90;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const ip = getIP(req);
  const rl = await checkRateLimit(`ativar-pro-anual:${ip}`, 10, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas. Aguarde.' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'Pagamento não configurado' });

  const { paymentId } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: 'paymentId obrigatório' });

  // 1) Fonte da verdade: consulta o pagamento no MP com o NOSSO token (nunca o corpo do cliente).
  let pg;
  try {
    const r = await fetch(`${MP_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!r.ok) return res.status(502).json({ error: 'Não foi possível consultar o pagamento no MP' });
    pg = await r.json();
  } catch {
    return res.status(502).json({ error: 'Falha ao consultar o pagamento' });
  }

  // 2) Verificações OBRIGATÓRIAS.
  if (!['approved', 'authorized'].includes(pg.status)) {
    return res.status(409).json({ error: 'pagamento_nao_aprovado', status: pg.status });
  }
  if (String(pg.metadata?.user_id || '') !== String(user.id)) {
    return res.status(403).json({ error: 'pagamento_de_outro_usuario' });
  }
  if (String(pg.metadata?.proposito || '') !== 'plano_anual') {
    return res.status(409).json({ error: 'proposito_invalido' });
  }

  // Preço anual VEM DO SERVIDOR — trava contra "paga R$1 e vira Pro".
  let precoAnual = PRECO_ANUAL_FALLBACK;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/planos_config?plano_key=eq.top2&select=preco_anual`, {
      headers: { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}` },
    });
    const [row] = await r.json().catch(() => []);
    if (row?.preco_anual) precoAnual = Number(row.preco_anual);
  } catch { /* usa o fallback */ }
  const valor = Number(pg.transaction_amount) || 0;
  if (Math.abs(valor - precoAnual) > Math.max(1, precoAnual * 0.01)) {
    return res.status(409).json({ error: 'valor_incompativel', esperado: precoAnual, recebido: valor });
  }

  // 3) Idempotência: um pagamento ativa UMA vez.
  const evento = 'pix_plano_anual';
  if (await eventoJaProcessado({ gateway: 'mercadopago', gatewayPaymentId: String(paymentId), evento })) {
    return res.status(200).json({ ok: true, jaAtivado: true });
  }

  // 4) Ativa o Pro ANUAL (role top2 base + plano_ciclo='anual' + plano_vencimento +12m; sem mandato).
  try {
    const result = await ativarPlanoDireto({
      userId: user.id,
      planoKey: 'top2_anual',
      gateway: 'mercadopago',
      cobranca: { gatewayPaymentId: String(paymentId), valor },
    });
    await auditLog({ acao: 'ativar_pro_anual_pix', user_id: user.id, ip, detalhes: { payment_id: paymentId, valor }, sucesso: true });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    // Efeito falhou depois da marca de idempotência → desmarca p/ o cliente reexecutar.
    await removerEventoProcessado({ gateway: 'mercadopago', gatewayPaymentId: String(paymentId), evento });
    return res.status(500).json({ error: 'falha_ativacao', detalhe: String(e?.message || e).slice(0, 200) });
  }
}
