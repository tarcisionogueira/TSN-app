/**
 * Webhook Mercado Pago → normaliza e delega ao _webhook-core.js
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/notifications/webhooks
 *
 * Env vars:
 *   MP_ACCESS_TOKEN       — access_token para consultar o pagamento
 *   MP_WEBHOOK_SECRET     — secret configurado no painel MP (X-Signature header)
 */
import crypto from 'crypto';
import { processarConfirmado, processarVencido, processarRecusado, processarChargeback, processarReembolso, eventoJaProcessado, removerEventoProcessado, ativarPlanoDireto, suspenderPlanoDireto } from './_webhook-core.js';
import { enviarEmail } from './_email.js';

const MP_BASE = 'https://api.mercadopago.com';

// Compra AVULSA de produto: o pagamento herda external_reference = compras_produtos.id
// (uuid) da preferência. Caminho 100% separado do de PLANO (external_reference tem pipe
// 'userId|plano') — nunca eleva role; ativa a compra + credita a comissão do parceiro.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const _SB_SVC = process.env.SUPABASE_SERVICE_KEY;
async function rpcProduto(fn, payload) {
  try {
    const r = await fetch(`${_SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    return r.ok ? await r.json() : { ok: false, http: r.status };
  } catch (e) { return { ok: false, erro: String(e?.message || e) }; }
}

// Espelho local (financeiro) — upsert idempotente via PostgREST. Fire-and-forget: nunca
// derruba o fluxo do webhook (o pagamento/plano já foi tratado; isto é só o registro).
async function upsertTabela(tabela, conflito, obj) {
  try {
    await fetch(`${_SB_URL}/rest/v1/${tabela}?on_conflict=${conflito}`, {
      method: 'POST',
      headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(obj), signal: AbortSignal.timeout(10000),
    });
  } catch (e) { console.error('[mp-webhook] upsert', tabela, e?.message); }
}

// Retorna:
//   'ok'         → assinatura válida (secret configurado e HMAC confere)
//   'sem_secret' → MP_WEBHOOK_SECRET não configurado (não bloqueia: cada evento é
//                  reconferido na API do MP com o nosso token, então não há como
//                  forjar ativação — só destrava enquanto o secret não é setado)
//   'invalida'   → secret configurado mas HMAC não confere → BLOQUEAR
function verificarAssinatura(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  // Sem secret, cada evento ainda é reconferido via API do MP antes de ativar
  // (não confia no corpo). Mas isso é uma brecha — logue alto para o secret ser setado.
  if (!secret) { console.error('[mp-webhook] CRÍTICO: MP_WEBHOOK_SECRET não configurado — assinatura não verificada. Configure no painel do Mercado Pago.'); return 'sem_secret'; }

  // MP envia x-signature: ts=<timestamp>,v1=<hmac>
  const xSig = req.headers['x-signature'] || '';
  const xReqId = req.headers['x-request-id'] || '';
  const match = xSig.match(/ts=(\d+),v1=([a-f0-9]+)/);
  if (!match) return 'invalida';

  const [, ts, v1] = match;
  const dataId = req.body?.data?.id || '';
  const template = `id:${dataId};request-id:${xReqId};ts:${ts};`;

  const expected = crypto.createHmac('sha256', secret).update(template).digest('hex');
  try {
    const eBuf = Buffer.from(expected);
    const vBuf = Buffer.from(v1);
    if (eBuf.length !== vBuf.length) return 'invalida';
    return crypto.timingSafeEqual(eBuf, vBuf) ? 'ok' : 'invalida';
  } catch { return 'invalida'; }
}

export default async function handler(req, res) {
  // Health-check: abrir a URL no navegador (GET) confirma que a função está viva
  // e acessível pelo domínio. Se aqui responde 200 JSON, o webhook existe e o
  // problema (quando houver) está na assinatura/eventos, não no deploy/roteamento.
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(200).json({ ok: true, service: 'mp-webhook', hint: 'Endpoint ativo. O Mercado Pago envia POST assinado aqui.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // Log de entrada: torna cada entrega do MP visível nos logs da Vercel
  // (antes, retornos silenciosos com 200 não geravam nenhuma linha de log).
  console.log('[mp-webhook] recebido', { type: req.body?.type, action: req.body?.action, dataId: req.body?.data?.id });

  const sig = verificarAssinatura(req);
  if (sig === 'invalida') {
    console.warn('[mp-webhook] assinatura inválida');
    return res.status(401).json({ error: 'Não autorizado' });
  }
  if (sig === 'sem_secret') {
    // Fail-closed: o MP_WEBHOOK_SECRET ESTÁ configurado em produção, então esta
    // condição só ocorre se a env for removida — aí bloqueamos em vez de aceitar
    // eventos não assinados.
    console.error('[mp-webhook] MP_WEBHOOK_SECRET ausente — bloqueando (401)');
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const tipo = req.body?.type || req.body?.action || '';
  const dataId = req.body?.data?.id;
  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const mpGet = async (path) => {
    const r = await fetch(`${MP_BASE}${path}`, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
    return r.ok ? r.json() : null;
  };

  // ── Assinaturas (checkout transparente / recorrência) ──────────────────────
  // subscription_preapproval: assinatura criada/ativada → ativa o plano.
  // subscription_authorized_payment: cobrança recorrente → mantém/renova o plano.
  // Mapeia pelo external_reference (userId|planoKey), não pelo valor.
  if (tipo === 'subscription_preapproval' || tipo === 'subscription_authorized_payment') {
    if (!dataId) return res.status(200).json({ ok: true, ignored: 'sem id' });
    if (!ACCESS_TOKEN) return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });
    try {
      let preapproval = null;
      let ap = null;
      let cobrancaRecusada = false;
      if (tipo === 'subscription_preapproval') {
        preapproval = await mpGet(`/preapproval/${dataId}`);
      } else {
        // Cobrança recorrente: 'processed' = paga; 'rejected' = falhou.
        ap = await mpGet(`/authorized_payments/${dataId}`);
        const st = ap?.status;
        if (st !== 'processed' && st !== 'rejected') return res.status(200).json({ ok: true, status: st || null });
        cobrancaRecusada = (st === 'rejected');
        if (ap?.preapproval_id) preapproval = await mpGet(`/preapproval/${ap.preapproval_id}`);
      }
      if (!preapproval) return res.status(200).json({ ok: true, erro: 'preapproval não encontrado' });
      const [userId, planoKey] = String(preapproval.external_reference || '').split('|');
      if (!userId) return res.status(200).json({ ok: true, status: preapproval.status });

      // Espelho local (financeiro). mp_assinaturas = estado da assinatura (para contar
      // assinantes ativos); a cobrança recorrente PROCESSADA vira uma "mensalidade recebida"
      // em mp_pagamentos (origem='recorrente'). Idempotente por id; não bloqueia o fluxo.
      await upsertTabela('mp_assinaturas', 'mp_assinatura_id', {
        mp_assinatura_id: String(preapproval.id || dataId), user_id: userId || null,
        plano_key: planoKey || null, status: preapproval.status || null,
        dados_mp: preapproval, atualizado_em: new Date().toISOString(),
      });
      if (tipo === 'subscription_authorized_payment' && ap && ap.status === 'processed') {
        await upsertTabela('mp_pagamentos', 'mp_payment_id', {
          mp_payment_id: String(ap.payment?.id || ap.id), user_id: userId || null, plano_key: planoKey || null,
          valor: ap.transaction_amount ?? ap.payment?.transaction_amount ?? null, status: 'approved',
          metodo: 'recorrente', origem: 'recorrente', external_ref: preapproval.external_reference || null,
          dados_mp: ap, atualizado_em: new Date().toISOString(),
        });
      }

      // Idempotência POR TRANSIÇÃO: o preapproval_id se repete durante todo o
      // ciclo de vida da assinatura. Chavear só por (id, tipo) fazia o evento de
      // cancelamento/pausa ser descartado como "duplicado" após o de ativação →
      // acesso pago vitalício. Incluir o status na chave separa as transições.
      // (authorized_payment tem id único por cobrança, então basta o tipo.)
      const idemEvento = tipo === 'subscription_preapproval'
        ? `subscription_preapproval:${preapproval.status}`
        : tipo;
      if (await eventoJaProcessado({ gateway: 'mercadopago', gatewayPaymentId: dataId, evento: idemEvento })) {
        return res.status(200).json({ ok: true, duplicado: true });
      }

      // FALHA: cobrança recusada, ou assinatura pausada/cancelada no MP → rebaixa + avisa.
      const assinaturaMorta = preapproval.status === 'paused' || preapproval.status === 'cancelled';
      if (cobrancaRecusada || assinaturaMorta) {
        // BLINDAGEM (P0.1 do design): NÃO rebaixar cego por userId. Se o cliente tem OUTRO
        // mandato authorized (troca de ciclo: cancelamos o mensal e criamos o anual — a ordem
        // de entrega dos webhooks do MP NÃO é garantida), o cancelamento do antigo não pode
        // clobberar a ativação do novo → senão vira explorador+inadimplente e o cron de
        // UPGRADE nunca resgata (só reativa com !inadimplente_desde).
        const outra = await mpGet(`/preapproval/search?payer_email=${encodeURIComponent(preapproval.payer_email || '')}&status=authorized&limit=10`);
        const temOutraAtiva = (outra?.results || []).some(p =>
          String(p.external_reference || '').split('|')[0] === userId && String(p.id) !== String(preapproval.id));
        if (temOutraAtiva) return res.status(200).json({ ok: true, ignorado: 'outro_mandato_ativo' });
        const result = await suspenderPlanoDireto({ userId, gateway: 'mercadopago' });
        if (result?.suspenso && preapproval.payer_email) {
          try {
            await enviarEmail({
              from: process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>',
              to: preapproval.payer_email,
              subject: 'Falha no pagamento da sua assinatura — BidPro Brasil',
              html: `<p>Olá!</p><p>Não conseguimos processar a cobrança da sua assinatura <strong>${preapproval.reason || 'BidPro Brasil'}</strong>. Seu acesso foi temporariamente reduzido ao plano Explorador.</p><p>Para reativar, atualize os dados do cartão na plataforma (Perfil → Assinatura). Assim que o pagamento for aprovado, seu plano volta automaticamente.</p><p>BidPro Brasil</p>`,
            });
          } catch { /* não bloqueia */ }
        }
        return res.status(200).json(result);
      }

      // SUCESSO: assinatura autorizada ou cobrança recorrente aprovada → ativa/renova.
      if (preapproval.status === 'authorized' && planoKey) {
        // Comissão SÓ mediante pagamento recebido: uma cobrança recorrente PROCESSADA
        // (subscription_authorized_payment + ap.status='processed') é dinheiro que ENTROU →
        // carrega a cobrança p/ o motor comissionar cada mensalidade. A mera autorização do
        // mandato (subscription_preapproval, sem ap) passa cobranca=null → ativa sem comissão.
        // Usa ap.payment.id (não ap.id) p/ idempotência e alinhamento com o estorno.
        const cobranca = (tipo === 'subscription_authorized_payment' && ap?.status === 'processed' && ap?.payment?.id)
          ? { gatewayPaymentId: String(ap.payment.id), valor: ap.transaction_amount ?? ap.payment?.transaction_amount }
          : null;
        const result = await ativarPlanoDireto({ userId, planoKey, gateway: 'mercadopago', cobranca });
        return res.status(200).json(result);
      }
      return res.status(200).json({ ok: true, status: preapproval.status });
    } catch (e) {
      console.error('[mp-webhook] assinatura:', e.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  // Apenas processar notificações de pagamento
  if (tipo !== 'payment' || !dataId) {
    return res.status(200).json({ ok: true, ignored: tipo });
  }

  // Busca detalhes completos do pagamento na API MP
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });

  let pagamento;
  try {
    const r = await fetch(`${MP_BASE}/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!r.ok) return res.status(200).json({ ok: true, erro: 'payment not found' });
    pagamento = await r.json();
  } catch (e) {
    console.error('[mp-webhook] erro ao buscar pagamento:', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }

  const status = pagamento.status;

  // Espelho local do pagamento (financeiro) — todas as transições de status. Recorrente vs
  // avulso pelo operation_type do MP. Idempotente por mp_payment_id; roda antes do corte de
  // idempotência para refletir pending→approved→charged_back. Não bloqueia o fluxo.
  {
    const ext = String(pagamento.external_reference || '').trim();
    const [refUser, refPlano] = ext.includes('|') ? ext.split('|') : [];
    await upsertTabela('mp_pagamentos', 'mp_payment_id', {
      mp_payment_id: String(pagamento.id),
      user_id: refUser || pagamento.metadata?.user_id || pagamento.metadata?.userId || null,
      plano_key: refPlano || pagamento.metadata?.planoKey || null,
      valor: pagamento.transaction_amount ?? null, status,
      status_detalhe: pagamento.status_detail || null, metodo: pagamento.payment_method_id || null,
      external_ref: ext || null, origem: pagamento.operation_type === 'recurring_payment' ? 'recorrente' : 'avulso',
      dados_mp: pagamento, atualizado_em: new Date().toISOString(),
    });
  }

  // Idempotência: o MP reenvia a mesma notificação. Se já tratamos este
  // (pagamento, status), responde OK sem reprocessar.
  if (await eventoJaProcessado({ gateway: 'mercadopago', gatewayPaymentId: pagamento.id, evento: status })) {
    return res.status(200).json({ ok: true, duplicado: true });
  }

  const payer = pagamento.payer || {};
  const contexto = {
    gateway: 'mercadopago',
    valor: pagamento.transaction_amount || 0,
    descricao: pagamento.description || '',
    email: payer.email || null,
    gatewayCustomerId: payer.id ? String(payer.id) : null,
    gatewayPaymentId: String(pagamento.id),
    metadados: pagamento.metadata || {},
    // Pagamento avulso de serviço (não-assinatura): o webhook não deve elevar plano.
    servico: (pagamento.metadata?.tipo === 'servico'),
  };

  // Produto avulso? external_reference é o uuid da compra (sem pipe).
  const extRefMp = String(pagamento.external_reference || '').trim();
  const ehProdutoMp = UUID_RE.test(extRefMp);

  try {
    let result;
    if (status === 'approved') {
      if (ehProdutoMp) {
        result = await rpcProduto('confirmar_compra_produto', { p_compra_id: extRefMp, p_gateway: 'mercadopago', p_gateway_payment_id: String(pagamento.id) });
        if (result && result.ok === false) {
          // Efeito falhou → desmarca a idempotência e devolve 5xx p/ o MP reenviar (senão a
          // compra ficaria presa em 'pendente' e a comissão nunca creditaria — sem reconciliação).
          await removerEventoProcessado({ gateway: 'mercadopago', gatewayPaymentId: pagamento.id, evento: status });
          return res.status(502).json({ error: 'confirmar_compra_produto_falhou', detalhe: result });
        }
        return res.status(200).json({ ok: true, produto: result });
      }
      result = await processarConfirmado(contexto);
    } else if (status === 'rejected' || status === 'cancelled') {
      result = await processarRecusado({ ...contexto, motivo: pagamento.status_detail || status });
    } else if (status === 'charged_back') {
      if (ehProdutoMp) {
        result = await rpcProduto('estornar_compra_produto', { p_gateway_payment_id: String(pagamento.id) });
        if (result && result.ok === false) {
          await removerEventoProcessado({ gateway: 'mercadopago', gatewayPaymentId: pagamento.id, evento: status });
          return res.status(502).json({ error: 'estornar_compra_produto_falhou', detalhe: result });
        }
        return res.status(200).json({ ok: true, produto_estorno: result });
      }
      result = await processarChargeback({
        ...contexto,
        evento: 'charged_back',
        motivo: pagamento.status_detail || 'charged_back',
        raw: { id: pagamento.id, status, status_detail: pagamento.status_detail },
      });
    } else if (status === 'refunded' || status === 'partially_refunded') {
      // Reembolso: estorna a comissão de rede e (no total) suspende o acesso. Antes caía no
      // 'ignored' → a comissão ficava paga sobre dinheiro devolvido (perda dupla / fraude).
      const parcial = status === 'partially_refunded';
      if (ehProdutoMp) {
        if (parcial) return res.status(200).json({ ok: true, ignorado: 'reembolso_parcial_produto' });
        result = await rpcProduto('estornar_compra_produto', { p_gateway_payment_id: String(pagamento.id) });
        if (result && result.ok === false) {
          await removerEventoProcessado({ gateway: 'mercadopago', gatewayPaymentId: pagamento.id, evento: status });
          return res.status(502).json({ error: 'estornar_compra_produto_falhou', detalhe: result });
        }
        return res.status(200).json({ ok: true, produto_estorno: result });
      }
      result = await processarReembolso({ ...contexto, suspender: !parcial });
    } else {
      // pending, in_process, authorized — aguardar próxima notificação
      return res.status(200).json({ ok: true, ignored: status });
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error('[mp-webhook]', e.message);
    // Efeito falhou após a marca de idempotência → desmarca p/ o MP reenviar.
    await removerEventoProcessado({ gateway: 'mercadopago', gatewayPaymentId: pagamento.id, evento: status });
    return res.status(500).json({ error: 'Erro interno' });
  }
}
