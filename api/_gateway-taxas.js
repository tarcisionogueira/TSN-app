// TAXAS REAIS DOS GATEWAYS (07/11) — leitura compartilhada por api/gateway-taxas.js (tela) e api/mp-checkout.js
// (servidor). Tabela `gateway_taxas`: ver supabase/migrations/20261107_gateway_taxas.sql.

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const sbH = () => ({ apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' });

/** payer_costs do MP → [{ parcelas, pct_cliente }]. Lança em erro (forma 1: nunca devolve vazio como resposta). */
export async function taxasDaApiMp({ valor = 1000, metodo = 'visa', bin = null } = {}) {
  const token = (process.env.MP_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('MP_ACCESS_TOKEN ausente');
  const q = new URLSearchParams({ amount: String(valor) });
  if (bin && /^\d{6,8}$/.test(String(bin))) q.set('bin', String(bin)); else q.set('payment_method_id', String(metodo || 'visa'));
  const r = await fetch(`https://api.mercadopago.com/v1/payment_methods/installments?${q}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`MP installments HTTP ${r.status}`);
  const j = await r.json();
  const custos = Array.isArray(j) ? j[0]?.payer_costs : null;
  if (!Array.isArray(custos) || !custos.length) throw new Error('MP installments sem payer_costs');
  return custos
    .filter((c) => Number(c.installments) >= 1 && Number(c.installments) <= 12 && Number.isFinite(Number(c.installment_rate)))
    .map((c) => ({ parcelas: Number(c.installments), pct_cliente: Number(c.installment_rate) }));
}

/** Linhas de `gateway_taxas` do cartão MP. Lança em erro de leitura. */
export async function lerTaxasCartaoMp() {
  const r = await fetch(`${SB_URL}/rest/v1/gateway_taxas?gateway=eq.mercadopago&meio=eq.cartao&select=parcelas,pct_cliente,fonte_cliente,cliente_em&order=parcelas`, {
    headers: sbH(), signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`gateway_taxas HTTP ${r.status}`);
  return r.json();
}

/** Grava o que a API informou (não passa por cima de observação real recente). Lança em erro. */
export async function gravarTaxasDaApi(taxas) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/gateway_taxas_da_api`, {
    method: 'POST', headers: sbH(), signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ p_gateway: 'mercadopago', p_meio: 'cartao', p_taxas: taxas, p_detalhe: `API payment_methods/installments da nossa conta, ${new Date().toISOString().slice(0, 10)}` }),
  });
  if (!r.ok) throw new Error(`gateway_taxas_da_api HTTP ${r.status}`);
}

/**
 * Juros do cliente { [n]: % } para ESTE pagamento: a API do MP para o cartão (bin/método) e valor reais; se ela não
 * responder, a tabela. Devolve { juros, fonte } ou lança se nenhuma das duas responder.
 */
export async function jurosDoPagamentoMp({ valor, metodo, bin }) {
  try {
    const taxas = await taxasDaApiMp({ valor, metodo, bin });
    return { juros: Object.fromEntries(taxas.map((t) => [t.parcelas, t.pct_cliente])), fonte: 'api' };
  } catch (e) {
    console.error('[gateway-taxas] API do MP não respondeu, usando a tabela:', e?.message || e);
    const linhas = await lerTaxasCartaoMp();
    if (!linhas.length) throw new Error('sem taxa de cartão do MP na tabela', { cause: e });
    return { juros: Object.fromEntries(linhas.map((l) => [l.parcelas, Number(l.pct_cliente)])), fonte: 'tabela' };
  }
}

/** Ensina a taxa com um pagamento real (Asaas/Inter). Nunca derruba quem chamou: devolve false e loga. */
export async function registrarTaxaObservada({ gateway, meio, parcelas = 1, ref, valor, liquido = null, totalPago = null }) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/registrar_taxa_observada`, {
      method: 'POST', headers: sbH(), signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ p_gateway: gateway, p_meio: meio, p_parcelas: parcelas, p_ref: ref, p_valor: valor, p_liquido: liquido, p_total_pago: totalPago }),
    });
    if (!r.ok) { console.error('[gateway-taxas] registrar_taxa_observada HTTP', r.status, await r.text().catch(() => '')); return false; }
    return true;
  } catch (e) {
    console.error('[gateway-taxas] registrar_taxa_observada falhou', e?.message || e);
    return false;
  }
}
