-- 15/11: amostras do mercadológico cujo próprio link diz leilão (pedido do dono: leilão polui o Índice).
-- gaenzo "casa-tambore-2-venda-direta-leilao" (Santana de Parnaíba) e corretoraqui "terreno-leilao-sfi" (Cotia).
-- A leitura do Índice já as escondia (ehAmostraDeLeilao pela URL); saem também da base.
delete from public.indice_amostra where id in ('c23e61a7-e73a-498b-8489-3efaea2aaffa', 'd4f5eaf6-db01-430f-aa53-fedaf1e1d028');
