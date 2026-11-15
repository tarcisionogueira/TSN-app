-- 15/11 — O extrator das 17h30–22h45 UTC transformava "à vista sem prova de parcelamento" em VETO
-- (parcelamentoPermitido=false) sem reconhecer "pagamento parcelado / art. 895 / financiado com o vendedor" (corrigido em
-- 4ec6305). 6 lotes gravaram esse veto em doc_fatos (5 cadastrados como hipotecado/financiado). Tira SÓ a chave — volta a
-- "não sabido"; a próxima geração relê o edital com o extrator corrigido. Nada é inventado no lugar.
update public.imoveis_leilao
   set doc_fatos = jsonb_set(doc_fatos, '{pagamento}', (doc_fatos->'pagamento') - 'parcelamentoPermitido')
 where doc_fatos_em > '2026-11-15 17:30:00+00' and doc_fatos_em < '2026-11-15 22:45:00+00'
   and doc_fatos->'pagamento'->>'parcelamentoPermitido' = 'false';
