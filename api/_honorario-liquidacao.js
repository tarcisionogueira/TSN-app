/**
 * LIQUIDAÇÃO DO HONORÁRIO DE ÊXITO SOBRE O LÍQUIDO RECEBIDO (10/10, pedido do dono).
 *
 * Regra `honorario.split_sobre_liquido` (regra_negocio). A conta do dinheiro mora numa função só,
 * no banco: `honorario_liquidar()` — trava a arrematação, soma a base líquida, abate o que ficou
 * com o advogado (cheques), credita o devido que já está disponível na conta (terceiros antes do
 * admin) e só marca 'distribuido' quando tudo compensou e tudo foi creditado.
 *
 * Aqui ficam as duas coisas que o banco não sabe fazer sozinho:
 *   1) descobrir o LÍQUIDO de cada recebimento e quanto dele já está disponível
 *      (Asaas: netValue/status da cobrança; Mercado Pago: mp_pagamentos.dados_mp; manuais: o valor);
 *   2) os PERCENTUAIS de cada um — vêm de calcularDistribuicao (api/_honorarios.js), a mesma regra
 *      de sempre (parceiro elegível, override individual, admin equilibra).
 *
 * Recebimento cujo líquido não se conseguiu ler fica com valor_liquido nulo, e a função NÃO
 * credita nada enquanto houver um assim — repassar sobre o bruto pagaria mais do que entrou.
 */
import { calcularDistribuicao } from './_honorarios.js';

const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();
const MANUAIS = new Set(['pix_externo', 'transferencia', 'dinheiro']);
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

async function asaasGet(path) {
  if (!ASAAS_KEY) throw new Error('ASAAS_API_KEY ausente');
  const r = await fetch(`${ASAAS_URL}${path}`, { headers: { access_token: ASAAS_KEY, 'User-Agent': 'BidPro' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Asaas ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

// Líquido e disponível de UMA cobrança Asaas. Cartão parcelado: a cobrança é uma parcela de um
// `installment` — somam-se todas as parcelas. Disponível = parcelas com status RECEIVED (o Asaas
// só passa a RECEIVED quando o dinheiro cai na conta; CONFIRMED é cartão aprovado e a receber).
async function liquidoAsaas(paymentId) {
  const p = await asaasGet(`/payments/${encodeURIComponent(paymentId)}`);
  let lista = [p];
  if (p.installment) {
    const inst = await asaasGet(`/payments?installment=${encodeURIComponent(p.installment)}&limit=100`);
    if (!Array.isArray(inst?.data) || !inst.data.length) throw new Error('parcelas do installment não vieram');
    lista = inst.data;
  }
  if (lista.some((x) => x.netValue == null)) throw new Error('cobrança sem netValue');
  const recebidas = new Set(['RECEIVED', 'RECEIVED_IN_CASH']);
  return {
    liquido: r2(lista.reduce((s, x) => s + Number(x.netValue), 0)),
    compensado: r2(lista.filter((x) => recebidas.has(x.status)).reduce((s, x) => s + Number(x.netValue), 0)),
  };
}

async function liquidoMp(db, paymentId) {
  const { data, ok, status } = await db(`mp_pagamentos?mp_payment_id=eq.${encodeURIComponent(paymentId)}&select=dados_mp&limit=1`);
  if (!ok) throw new Error(`mp_pagamentos HTTP ${status}`);
  const d = Array.isArray(data) ? data[0]?.dados_mp : null;
  const net = d?.transaction_details?.net_received_amount;
  if (net == null) throw new Error('pagamento MP sem net_received_amount');
  const liberado = d.money_release_status === 'released' || (d.money_release_date && new Date(d.money_release_date) <= new Date());
  return { liquido: r2(net), compensado: liberado ? r2(net) : 0 };
}

// Atualiza valor_liquido / liquido_compensado dos recebimentos confirmados da arrematação.
// Devolve a lista de falhas (recebimento que ficou sem líquido) — nunca engole o motivo.
export async function atualizarLiquidos(db, arrId) {
  const { data: recs, ok, status } = await db(`honorarios_recebimentos?arrematacao_id=eq.${arrId}&status=eq.confirmado&select=id,metodo,valor,valor_liquido,liquido_compensado,em_poder,compensado_em,gateway_payment_id`);
  if (!ok || !Array.isArray(recs)) throw new Error(`leitura dos recebimentos HTTP ${status}`);
  const falhas = [];
  for (const r of recs) {
    // Já fechado: líquido conhecido e todo disponível (ou com o advogado, onde "disponível" não se aplica).
    if (r.valor_liquido != null && (r.em_poder === 'advogado' || Number(r.liquido_compensado || 0) >= Number(r.valor_liquido) - 0.005)) continue;
    let v;
    try {
      if (r.metodo === 'cheque' || MANUAIS.has(r.metodo)) {
        // Manual: o valor É o líquido. Cheque na mão da plataforma só fica disponível quando compensa.
        const disp = r.em_poder === 'advogado' ? null : (r.metodo === 'cheque' ? (r.compensado_em ? r2(r.valor) : 0) : r2(r.valor));
        v = { liquido: r2(r.valor), compensado: disp };
      } else if (/_asaas$/.test(r.metodo)) {
        if (!r.gateway_payment_id) throw new Error('recebimento Asaas sem gateway_payment_id');
        v = await liquidoAsaas(r.gateway_payment_id);
      } else if (/_mp$/.test(r.metodo)) {
        if (!r.gateway_payment_id) throw new Error('recebimento MP sem gateway_payment_id');
        v = await liquidoMp(db, r.gateway_payment_id);
      } else {
        throw new Error(`método ${r.metodo} sem regra de líquido`);
      }
    } catch (e) {
      falhas.push({ id: r.id, metodo: r.metodo, erro: String(e?.message || e).slice(0, 160) });
      continue;
    }
    const corpo = { valor_liquido: v.liquido, liquido_atualizado_em: new Date().toISOString(), ...(v.compensado != null ? { liquido_compensado: v.compensado } : {}) };
    const up = await db(`honorarios_recebimentos?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify(corpo), headers: { Prefer: 'return=representation' } });
    if (!up.ok || !Array.isArray(up.data) || !up.data.length) falhas.push({ id: r.id, metodo: r.metodo, erro: `gravação HTTP ${up.status}` });
  }
  return falhas;
}

// Liquida uma arrematação: atualiza líquidos, pega os percentuais e deixa o banco creditar.
// `seco` = só calcula (para a tela do advogado/admin), não grava crédito nem status.
export async function liquidarHonorario(db, arr, { seco = false } = {}) {
  const falhas = seco ? [] : await atualizarLiquidos(db, arr.id);
  const dist = await calcularDistribuicao(db, arr);
  const linhas = dist.linhas.filter((l) => l.pct > 0).map((l) => ({ papel: l.papel, id: l.id, nome: l.nome, pct: l.pct }));
  const r = await db('rpc/honorario_liquidar', { method: 'POST', body: JSON.stringify({ p_arrematacao: arr.id, p_linhas: linhas, p_total: dist.total, p_seco: seco }) });
  if (!r.ok || !r.data?.ok) throw new Error(`honorario_liquidar: ${r.data?.erro || r.data?.message || `HTTP ${r.status}`}`);
  return { ...r.data, falhas_liquido: falhas };
}
