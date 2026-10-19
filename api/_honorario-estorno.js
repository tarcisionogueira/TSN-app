/**
 * Reversão de honorário/cobrança avulsa estornados (chargeback/reembolso) — compartilhado
 * entre api/mp-webhook.js e api/asaas-webhook.js (18/09, fallback automático MP→Asaas) pra
 * não duplicar a mesma lógica de banco em dois gateways e deixar as duas cópias divergirem.
 */
const _SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const _SB_SVC = process.env.SUPABASE_SERVICE_KEY;

// Estorno/chargeback de honorário de êxito. O estorno é da PARTE específica paga por este
// payment_id, não do honorário inteiro — um cliente pode ter Pix+cheque legítimos recebidos
// por fora e só a fatia do cartão sendo estornada; reverter tudo para 'pendente' apagaria o
// rastro do que já foi recebido de verdade. Marca a linha 'estornado' e deixa a trigger do
// banco (honorarios_recebimentos_fecha_se_completo) recalcular e reabrir 'pendente' se a
// soma cair abaixo do total. Sem linha correspondente (registro anterior a esta migração,
// pago 100% de uma vez pelo caminho antigo): cai no fallback direto, igual antes.
// Se JÁ foi distribuído à equipe (saldo_lancamentos creditado), reverter sozinho aqui seria
// mexer em saldo de terceiro sem as mesmas guardas de `distribuirHonorarios` — fica
// registrado no log para conferência manual, nunca falha silenciosa.
export async function reverterHonorarioEstornado(arrId, evento, paymentId) {
  // 19/10 (pendência 231): leituras e escritas conferidas — leitura falha virava "nada a estornar"
  // e o PATCH com return=minimal sem checar .ok perdia o estorno com o webhook respondendo 200.
  // Lançar aqui faz o webhook desfazer a marca e o gateway reentregar.
  const H = { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}` };
  const arrRes = await fetch(`${_SB_URL}/rest/v1/arrematacoes?id=eq.${arrId}&select=id,honorarios_status`, { headers: H });
  if (!arrRes.ok) throw new Error(`honorario-estorno: leitura da arrematação falhou (${arrRes.status})`);
  const [arr] = await arrRes.json();
  // Desde 10/10 a liquidação credita fatias com o status ainda 'pago' (repasse PARCIAL) e
  // honorario_liquidar nunca debita. Então "já distribuído" não é só o status: é haver crédito
  // positivo vivo desta arrematação. Nesses casos o estorno vai para a fila de conferência
  // (invariante pagamento_sem_conferencia) — mexer em saldo de terceiro fica com a equipe.
  const lRes = await fetch(`${_SB_URL}/rest/v1/saldo_lancamentos?origem_tipo=eq.arrematacao&origem_id=eq.${arrId}&valor=gt.0&status=neq.cancelado&select=id,valor`, { headers: H });
  if (!lRes.ok) throw new Error(`honorario-estorno: leitura dos repasses falhou (${lRes.status})`);
  const repasses = await lRes.json();
  const creditado = repasses.reduce((t, l) => t + Number(l.valor || 0), 0);
  if (creditado > 0 || arr?.honorarios_status === 'distribuido') {
    const cRes = await fetch(`${_SB_URL}/rest/v1/pagamentos_conferencia?on_conflict=gateway,gateway_payment_id`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ gateway: `estorno_${evento}`, gateway_payment_id: String(paymentId || arrId), referencia: `arrematacao:${arrId}`, valor: creditado, esperado: 0, motivo: 'estorno_com_repasse_creditado' }),
    });
    if (!cRes.ok) throw new Error(`honorario-estorno: fila de conferência falhou (${cRes.status})`);
    console.error(`[honorario-estorno] ${evento} com R$ ${creditado.toFixed(2)} já repassado à equipe — enviado à conferência`, { arrId });
    if (arr?.honorarios_status === 'distribuido') return { revertido: false, conferencia: true };
  }
  if (paymentId) {
    const recRes = await fetch(`${_SB_URL}/rest/v1/honorarios_recebimentos?arrematacao_id=eq.${arrId}&gateway_payment_id=eq.${paymentId}&status=eq.confirmado&select=id`, { headers: H });
    if (!recRes.ok) throw new Error(`honorario-estorno: leitura do recebimento falhou (${recRes.status})`);
    const [rec] = await recRes.json();
    if (rec) {
      const pr = await fetch(`${_SB_URL}/rest/v1/honorarios_recebimentos?id=eq.${rec.id}&status=eq.confirmado`, {
        method: 'PATCH',
        headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'estornado' }),
      });
      if (!pr.ok) throw new Error(`honorario-estorno: marcar parte estornada falhou (${pr.status})`);
      return { revertido: true, parte: rec.id, conferencia: creditado > 0 };
    }
  }
  // Fallback (sem linha de recebimento correspondente): comportamento antigo.
  if (arr?.honorarios_status === 'pago') {
    const pr = await fetch(`${_SB_URL}/rest/v1/arrematacoes?id=eq.${arrId}&honorarios_status=eq.pago`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ honorarios_status: 'pendente', honorarios_pago_em: null }),
    });
    if (!pr.ok) throw new Error(`honorario-estorno: reabrir honorário falhou (${pr.status})`);
    return { revertido: true, conferencia: creditado > 0 };
  }
  return { revertido: false, conferencia: creditado > 0 };
}

// Estorno/chargeback de cobrança avulsa: mais simples que honorário — não existe conceito
// de "distribuído à equipe" nem de partes múltiplas, é 1 cobrança = 1 pagamento. Só reabre
// se ainda estava 'paga' por ESTE payment_id (idempotência básica).
export async function reverterCobrancaAvulsaEstornada(cobrancaId, evento, paymentId = null) {
  const r = await fetch(`${_SB_URL}/rest/v1/cobrancas_avulsas?id=eq.${cobrancaId}&select=id,status,gateway_payment_id,valor,valor_pago_pix`, {
    headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}` },
  });
  if (!r.ok) throw new Error(`cobranca-estorno: leitura falhou (${r.status})`); // 19/10: não é "nada a estornar"
  const [cob] = await r.json();
  // 19/10 (#255): o estorno é de UM pagamento. Se não foi o que QUITOU (ex.: Pix parcial A + cartão B,
  // estorno de A), reabrir a cobrança inteira cobraria de novo a parte B. Esse caso vai para a conferência
  // humana; só o pagamento que fechou a cobrança a reabre (o saldo volta a ser exatamente a parte dele).
  // Quitada por PIX, o valor_pago_pix já soma a parte estornada: reabrir deixaria saldo 0 com status aberta.
  const saldoZerado = cob?.status === 'paga' && Number(cob.valor_pago_pix || 0) >= Number(cob.valor || 0) - 0.01;
  if (paymentId && cob && (String(cob.gateway_payment_id || '') !== String(paymentId) || saldoZerado)) {
    const cRes = await fetch(`${_SB_URL}/rest/v1/pagamentos_conferencia?on_conflict=gateway,gateway_payment_id`, {
      method: 'POST',
      headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ gateway: `estorno_${evento}`, gateway_payment_id: String(paymentId), referencia: `cobranca:${cobrancaId}`, motivo: 'estorno_pagamento_parcial_cobranca' }),
    });
    if (!cRes.ok) throw new Error(`cobranca-estorno: fila de conferência falhou (${cRes.status})`);
    return { revertido: false, conferencia: true };
  }
  if (cob?.status !== 'paga') return { revertido: false };
  const pr = await fetch(`${_SB_URL}/rest/v1/cobrancas_avulsas?id=eq.${cobrancaId}&status=eq.paga`, {
    method: 'PATCH',
    headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'aberta', pago_em: null }),
  });
  if (!pr.ok) throw new Error(`cobranca-estorno: reabrir falhou (${pr.status})`);
  console.error(`[honorario-estorno] cobranca_avulsa ${evento} — reaberta para nova cobrança`, { cobrancaId });
  return { revertido: true };
}
