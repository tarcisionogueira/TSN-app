-- 15/11 — lote MEGA X131536 (Brooklin, apto 212, 11a253f3): o edital (lido por inteiro, 9 páginas) exige o preço
-- TODO em 24 h, à vista (cláusulas 1.5 e 2.1), comissão 5% (2.1.2) e PROÍBE FGTS (2.2). O extrator leu `fgts: true`
-- por causa da palavra na frase de proibição, e o gerar-analise reescreveu o lote para 'financiado' — o relatório
-- projetou 5% de sinal + parcela de banco. Conserto do extrator no mesmo commit (api/_doc-extracao.js).
update public.imoveis_leilao
   set forma_pagamento = 'a_vista',
       doc_fatos = jsonb_set(coalesce(doc_fatos, '{}'::jsonb), '{pagamento}',
         jsonb_build_object('aVista', true, 'fgts', false, 'financiavel', false, 'parcelamentoPermitido', false,
                            'comissaoPct', 5, 'prazoDias', 1, 'origem', 'edital_conferido_15_11'))
 where id = '11a253f3-475c-422c-9417-4e06f1196bd4';
