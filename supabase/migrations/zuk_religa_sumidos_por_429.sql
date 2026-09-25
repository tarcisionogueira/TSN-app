-- 25/09: o "carregar mais" da listagem ZUK toma 429 no meio; o coletor tomava a lista parcial
-- como completa e o sweep desligava como `sumiu_da_fonte` lotes com praça AINDA POR VIR — ex.:
-- Z37342 (2ª praça 14/10, lance correndo na página). Recon: 34 de 58 "sumidos" com 2ª praça
-- futura estavam na listagem. O coletor agora marca coleta parcial (sweep não roda) e espera no
-- 429. Aqui: religa os sumidos dos últimos 14 dias com praça futura e sem resultado. O que a fonte
-- tirou de fato sai na próxima coleta COMPLETA, ou pela data (desativar_leiloes_encerrados).
update public.imoveis_leilao
   set ativo = true, suprimido_motivo = null
 where fonte = 'ZUK' and not ativo and suprimido_motivo = 'sumiu_da_fonte'
   and atualizado_em > now() - interval '14 days'
   and coalesce(status, 'disponivel') = 'disponivel' and resultado_leilao is null
   and (data_leilao_2 > now()
        or left(data_leilao, 10) >= to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'));
