// TAXA DO MEIO DE PAGAMENTO REPASSADA AO CLIENTE NO HONORÁRIO DE ÊXITO (30/09, decisão do dono).
//
// Uma regra só para a TELA (src/pages/PagarHonorario.jsx mostra o total) e para o SERVIDOR
// (api/mp-checkout.js e api/asaas.js cobram o total; os webhooks descontam a taxa ao dar baixa) —
// se as duas pontas calculassem separado, o cliente veria um valor e pagaria outro.
//
// O honorário LÍQUIDO que a BidPro recebe continua exatamente o saldo devido; a taxa vai POR CIMA:
//  · boleto (Asaas): tarifa FIXA por boleto pago → soma direta.
//  · cartão (Mercado Pago): tarifa PERCENTUAL sobre o total cobrado → "gross-up": total tal que
//    total − total×pct = saldo. Somar pct×saldo ficaria alguns reais abaixo em honorário alto.
//    2,48% = taxa MEDIDA nos cartões aprovados à vista (mp_pagamentos.fee_details, 30/09). Juros de
//    parcelamento acima do sem-juros já são do cliente pelo próprio MP — não entram aqui.
//  · cartão (Asaas, reserva quando o MP recusa): 2,99% + R$ 0,49 (tabela pública).
// Pix saiu dos honorários (decisão do dono, 30/09).
export const TAXA_BOLETO_ASAAS = 3.49;
export const TAXA_CARTAO_MP_PCT = 2.48;
export const TAXA_CARTAO_ASAAS = { pct: 2.99, fixo: 0.49 };

const paraCima = (v) => Math.ceil(Math.round(v * 1000) / 10) / 100; // arredonda PARA CIMA no centavo (nunca recebe menos)
const r2 = (v) => Math.round(v * 100) / 100;

// meio: 'boleto_asaas' | 'cartao_mp' | 'cartao_asaas'
export function honorarioComTaxa(saldo, meio) {
  const h = r2(Number(saldo) || 0);
  if (!(h > 0)) return { honorario: 0, taxa: 0, total: 0 };
  let total;
  if (meio === 'boleto_asaas') total = r2(h + TAXA_BOLETO_ASAAS);
  else if (meio === 'cartao_mp') total = paraCima(h / (1 - TAXA_CARTAO_MP_PCT / 100));
  else if (meio === 'cartao_asaas') total = paraCima((h + TAXA_CARTAO_ASAAS.fixo) / (1 - TAXA_CARTAO_ASAAS.pct / 100));
  else throw new Error(`meio de pagamento desconhecido: ${meio}`);
  return { honorario: h, taxa: r2(total - h), total };
}
