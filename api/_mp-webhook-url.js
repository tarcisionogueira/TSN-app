// URL de aviso entregue ao Mercado Pago em cada pagamento/assinatura.
// O domínio sem www responde 308 para o www, e o aviso do MP não chega à fila passando por esse redirect:
// medido em 08/11, os 2 pagamentos com a URL sem www ficaram sem baixa (William R$ 8.000, Marcos R$ 1.000),
// enquanto os 7 que usaram a URL configurada no painel do MP chegaram. Por isso a URL sai já no destino final.
export function urlWebhookMp(base = process.env.APP_BASE_URL) {
  const raiz = String(base || 'https://www.bidprobrasil.com.br').trim().replace(/\/+$/, '');
  return `${raiz.replace(/^https?:\/\/bidprobrasil\.com\.br$/i, 'https://www.bidprobrasil.com.br')}/api/mp-webhook`;
}
