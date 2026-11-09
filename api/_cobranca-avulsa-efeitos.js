/**
 * O que acontece depois que uma cobrança avulsa é paga (dono, 08/11): ativa o plano do produto na conta do destinatário e
 * cancela o que ainda estiver pendente nos dois gateways, porque o link é de uso único.
 *
 * Roda no cron de 1 minuto, para os dois webhooks caírem no mesmo caminho e a falha ter nova tentativa. Dependências
 * injetadas: o teste roda sem banco nem gateway.
 */
import { efeitoDoProduto } from '../src/lib/cobranca-produto.js';

export const gatewayDoPagamento = (id) => (String(id || '').startsWith('pay_') ? 'asaas' : 'mercadopago');

async function ativarProduto(cob, efeito, d) {
  const gateway = gatewayDoPagamento(cob.gateway_payment_id);
  const valor = Number(cob.valor) || 0;
  const valorLiquido = d.valorLiquido ?? valor;
  const gatewayPaymentId = cob.gateway_payment_id;
  if (efeito.tipo === 'assessoria') {
    // Sem o id de cliente do gateway: quem paga pode ser outra pessoa, e o link foi gerado para o destinatário.
    const r = await d.processarConfirmado({
      valor, valorLiquido, descricao: cob.descricao, email: cob.destinatario_email, gatewayCustomerId: null,
      gatewayPaymentId, gateway, servico: false, planoForcado: 'assessorado',
    });
    if (r?.skipped) throw new Error(`conta de ${cob.destinatario_email || 'destinatário vazio'} não encontrada`);
    return;
  }
  const cliente = await d.buscarCliente({ gatewayCustomerId: null, email: cob.destinatario_email, gateway });
  if (!cliente) throw new Error(`conta de ${cob.destinatario_email || 'destinatário vazio'} não encontrada`);
  await d.ativarPlanoDireto({ userId: cliente.id, planoKey: efeito.planoKey, gateway, cobranca: { gatewayPaymentId, valor, valorLiquido } });
}

async function cancelarPendentesAsaas(cob, d) {
  const ref = encodeURIComponent(`cobranca_avulsa|${cob.id}`);
  const canceladas = [];
  for (const status of ['PENDING', 'OVERDUE']) {
    const r = await d.fetch(`${d.asaasUrl}/payments?externalReference=${ref}&status=${status}&limit=50`, { headers: { access_token: d.asaasKey } });
    if (!r.ok) throw new Error(`Asaas: leitura de ${status} HTTP ${r.status}`);
    const { data = [] } = await r.json();
    for (const p of data) {
      if (p.id === cob.gateway_payment_id) continue;
      const del = await d.fetch(`${d.asaasUrl}/payments/${p.id}`, { method: 'DELETE', headers: { access_token: d.asaasKey } });
      if (!del.ok) throw new Error(`Asaas: cancelar ${p.id} HTTP ${del.status}`);
      canceladas.push(p.id);
    }
  }
  return canceladas;
}

// Pix ou boleto do MP já expirado não aceita cancelamento e deixa de ser pagável: registra, sem prender a cobrança.
async function cancelarPendentesMp(cob, d) {
  const canceladas = [];
  const recusadas = [];
  for (const id of d.mpPendentes || []) {
    if (String(id) === String(cob.gateway_payment_id)) continue;
    const r = await d.fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${d.mpToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (r.ok) canceladas.push(id);
    else recusadas.push(`${id}: HTTP ${r.status}`);
  }
  return { canceladas, recusadas };
}

export async function aplicarEfeitosDaCobranca(cob, d) {
  const efeito = efeitoDoProduto(cob.produto_key);
  let ativou = false;
  // Quando o cancelamento falha e a rodada repete, a ativação não roda duas vezes.
  if (efeito && !cob.produto_ativado_em) {
    await ativarProduto(cob, efeito, d);
    await d.marcarAtivado(cob.id);
    ativou = true;
  }
  const asaas = await cancelarPendentesAsaas(cob, d);
  const mp = await cancelarPendentesMp(cob, d);
  return { ativou, asaas_canceladas: asaas, mp_canceladas: mp.canceladas, mp_recusadas: mp.recusadas };
}
