-- 21/10 — ANUAL EM TODOS OS PLANOS, MESMO DESCONTO DO PRO (dono: "o plano anual deixe disponível para todos os
-- planos com o mesmo % de desconto"). Pro: 12 × 89,90 = 1.078,80 → 899,00 (−16,7%, 10 meses pelo preço de 12).
-- Mesma razão: Veículos 12 × 29,90 = 358,80 → 299,00; Combo 12 × 99,90 = 1.198,80 → 999,00.
-- Lido por api/mp.js (veiculos_anual/combo_anual, preapproval de 12 meses), api/asaas.js (variante YEARLY
-- gerada de preco_anual) e o Checkout. O acesso a veículos cresce 12 meses por cobrança anual
-- (mesesDoCiclo em api/_webhook-core.js).
update public.planos_config set preco_anual = 299.00 where plano_key = 'veiculos' and preco_anual is null;
update public.planos_config set preco_anual = 999.00 where plano_key = 'combo' and preco_anual is null;
