/**
 * GET /api/gateway-taxas
 *
 * Juros que o CLIENTE paga por nº de parcelas no cartão do Mercado Pago — o número que a tela de pagamento e as
 * vitrines mostram (07/11, dono: "trazer as taxas reais de cobrança de cada gateway").
 *
 * Ordem: tabela `gateway_taxas` (observado em pagamento real > API > referência). Se a parte da API tem mais de
 * 24 h, pergunta de novo ao MP (`/v1/payment_methods/installments`, com o token da conta) e grava — a API diz a
 * taxa da NOSSA conta, que muda quando o MP muda a tabela ou o dono muda a configuração de parcelamento.
 * Público (é o que qualquer pagador vê no próprio checkout do MP); só devolve percentuais.
 */
export const config = { runtime: 'edge' };

import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { taxasDaApiMp, lerTaxasCartaoMp, gravarTaxasDaApi } from './_gateway-taxas.js';

const IDADE_MAX_API_MS = 24 * 3600 * 1000;

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const rl = await checkRateLimit(`gateway-taxas:${getIP(req)}`, 60, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  let linhas;
  try { linhas = await lerTaxasCartaoMp(); } catch (e) {
    console.error('[gateway-taxas] leitura falhou', e?.message || e);
    return new Response(JSON.stringify({ error: 'taxas_indisponiveis' }), { status: 503 });
  }

  // Parte da API velha → pergunta ao MP. Falhou: segue com o que está gravado e diz no `aviso` — não inventa.
  let aviso = null;
  const apiVelha = !linhas.length || linhas.some((l) => l.fonte_cliente !== 'observada' && Date.now() - new Date(l.cliente_em).getTime() > IDADE_MAX_API_MS);
  if (apiVelha) {
    try {
      await gravarTaxasDaApi(await taxasDaApiMp());
      linhas = await lerTaxasCartaoMp();
    } catch (e) {
      aviso = `não consegui atualizar pela API do Mercado Pago (${e?.message || e}); valendo a última taxa gravada`;
      console.error('[gateway-taxas]', aviso);
    }
  }

  const juros = {};
  const fontes = {};
  for (const l of linhas) { juros[l.parcelas] = Number(l.pct_cliente); fontes[l.parcelas] = l.fonte_cliente; }
  return new Response(JSON.stringify({ gateway: 'mercadopago', meio: 'cartao', juros, fontes, aviso }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
  });
}
