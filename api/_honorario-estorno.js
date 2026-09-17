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
  const arrRes = await fetch(`${_SB_URL}/rest/v1/arrematacoes?id=eq.${arrId}&select=id,honorarios_status`, {
    headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}` },
  });
  const [arr] = arrRes.ok ? await arrRes.json() : [];
  if (arr?.honorarios_status === 'distribuido') {
    console.error(`[honorario-estorno] ${evento} de honorário já distribuído à equipe — requer conferência manual`, { arrId });
    return { revertido: false };
  }
  if (paymentId) {
    const recRes = await fetch(`${_SB_URL}/rest/v1/honorarios_recebimentos?arrematacao_id=eq.${arrId}&gateway_payment_id=eq.${paymentId}&status=eq.confirmado&select=id`, {
      headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}` },
    });
    const [rec] = recRes.ok ? await recRes.json() : [];
    if (rec) {
      await fetch(`${_SB_URL}/rest/v1/honorarios_recebimentos?id=eq.${rec.id}`, {
        method: 'PATCH',
        headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'estornado' }),
      });
      return { revertido: true, parte: rec.id };
    }
  }
  // Fallback (sem linha de recebimento correspondente): comportamento antigo.
  if (arr?.honorarios_status === 'pago') {
    await fetch(`${_SB_URL}/rest/v1/arrematacoes?id=eq.${arrId}`, {
      method: 'PATCH',
      headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ honorarios_status: 'pendente', honorarios_pago_em: null }),
    });
    return { revertido: true };
  }
  return { revertido: false };
}

// Estorno/chargeback de cobrança avulsa: mais simples que honorário — não existe conceito
// de "distribuído à equipe" nem de partes múltiplas, é 1 cobrança = 1 pagamento. Só reabre
// se ainda estava 'paga' por ESTE payment_id (idempotência básica).
export async function reverterCobrancaAvulsaEstornada(cobrancaId, evento) {
  const r = await fetch(`${_SB_URL}/rest/v1/cobrancas_avulsas?id=eq.${cobrancaId}&select=id,status`, {
    headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}` },
  });
  const [cob] = r.ok ? await r.json() : [];
  if (cob?.status !== 'paga') return { revertido: false };
  await fetch(`${_SB_URL}/rest/v1/cobrancas_avulsas?id=eq.${cobrancaId}`, {
    method: 'PATCH',
    headers: { apikey: _SB_SVC, Authorization: `Bearer ${_SB_SVC}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'aberta', pago_em: null }),
  });
  console.error(`[honorario-estorno] cobranca_avulsa ${evento} — reaberta para nova cobrança`, { cobrancaId });
  return { revertido: true };
}
