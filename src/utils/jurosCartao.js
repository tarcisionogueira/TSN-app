// JUROS REAIS DO PARCELADO NO CARTÃO (07/11, dono: "trazer as taxas reais de cobrança de cada gateway").
//
// Duas fontes, da mais precisa para a mais geral:
//  1. o CARTÃO digitado: com o BIN (6 primeiros dígitos, que o Secure Field do MP já entrega), pergunta à API
//     pública do Mercado Pago quanto ELE cobra do cliente em cada parcela, para este valor — é o número que vai
//     aparecer na fatura;
//  2. a tabela `gateway_taxas` via /api/gateway-taxas (API do MP da nossa conta + o que já foi observado em
//     pagamento real), para vitrines e para antes de o cartão ser digitado.
// Nenhuma das duas respondeu → `null`, e src/utils/parcelamento.js usa TAXAS_MP_REFERENCIA (07/11).
import { useEffect, useState } from 'react';

const MP_PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY || '';
let cacheTabela = null;
let pedidoTabela = null;

function lerTabela() {
  if (cacheTabela) return Promise.resolve(cacheTabela);
  if (!pedidoTabela) {
    pedidoTabela = fetch('/api/gateway-taxas')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`gateway-taxas HTTP ${r.status}`))))
      .then((j) => {
        const juros = j?.juros && Object.keys(j.juros).length ? j.juros : null;
        if (!juros) throw new Error('gateway-taxas sem juros');
        cacheTabela = juros;
        return juros;
      })
      .catch((e) => { pedidoTabela = null; throw e; });
  }
  return pedidoTabela;
}

async function lerDoCartao(valor, bin) {
  const q = new URLSearchParams({ amount: String(valor), bin: String(bin), public_key: MP_PUBLIC_KEY });
  const r = await fetch(`https://api.mercadopago.com/v1/payment_methods/installments?${q}`);
  if (!r.ok) throw new Error(`MP installments HTTP ${r.status}`);
  const j = await r.json();
  const custos = Array.isArray(j) ? j[0]?.payer_costs : null;
  if (!Array.isArray(custos) || !custos.length) throw new Error('MP installments sem payer_costs');
  return Object.fromEntries(custos.filter((c) => Number.isFinite(Number(c.installment_rate))).map((c) => [Number(c.installments), Number(c.installment_rate)]));
}

/** { juros: {[n]: %} | null, fonte: 'cartao' | 'tabela' | 'referencia' } */
export function useJurosCartao({ valor = null, bin = '' } = {}) {
  const [tabela, setTabela] = useState(cacheTabela);
  const [doCartao, setDoCartao] = useState(null);

  useEffect(() => {
    let vivo = true;
    lerTabela().then((j) => { if (vivo) setTabela(j); })
      .catch((e) => console.warn('[juros-cartao] tabela indisponível, usando a referência de 07/11:', e?.message || e));
    return () => { vivo = false; };
  }, []);

  const binOk = /^\d{6,8}$/.test(String(bin || '')) && Number(valor) > 0 && MP_PUBLIC_KEY;
  useEffect(() => {
    if (!binOk) { setDoCartao(null); return undefined; }
    let vivo = true;
    lerDoCartao(valor, bin).then((j) => { if (vivo) setDoCartao(j); })
      .catch((e) => { if (vivo) setDoCartao(null); console.warn('[juros-cartao] API do MP para o cartão não respondeu (adblock?), usando a tabela:', e?.message || e); });
    return () => { vivo = false; };
  }, [binOk, valor, bin]);

  if (doCartao) return { juros: doCartao, fonte: 'cartao' };
  if (tabela) return { juros: tabela, fonte: 'tabela' };
  return { juros: null, fonte: 'referencia' };
}
