-- Correção do resultado dos lotes do LEILÃO ELETRÔNICO encerrados entre 20 e 29/10 (30/10).
--
-- Conferido lote a lote na API do site (POST /ApiEngine/GetRealTime, a mesma chamada da página)
-- em 30/10 ~14h40. O leitor genérico lia o texto-modelo "Sem lance" da página (ver
-- api/_resultado-leilaoeletronico.js) e o robô não abria a página para os demais:
--   · 3 marcados "sem_lance" tinham sido ARREMATADOS (2626, 2634, 2681);
--   · 65 sem resultado: 21 arrematados, 43 sem lance, 1 com lance sem vencedor (2331 → indeterminado).
-- Regras iguais a patchDaApuracao(): sem_lance religa o que a limpeza desligou por praça vencida;
-- vendido sai da vitrine na próxima limpeza horária.
with v(lote, resultado, valor) as (values
  (2626,'vendido',768000),(2634,'vendido',384000),(2681,'vendido',262000),
  (2644,'vendido',22000),(2659,'vendido',1390677.39),(2716,'vendido',435500),(2687,'vendido',409000),
  (2664,'vendido',930000),(2635,'vendido',191000),(2709,'vendido',240000),(2630,'vendido',370817.01),
  (2651,'vendido',1580000),(2652,'vendido',329010.31),(2650,'vendido',299400),(2663,'vendido',391992.05),
  (2666,'vendido',416400),(2671,'vendido',460000),(2678,'vendido',329000),(2673,'vendido',304000),
  (2682,'vendido',205000),(2711,'vendido',212000),(2685,'vendido',246000),(2715,'vendido',1371000),
  (2665,'vendido',973400),
  (2331,'indeterminado',null),
  (2661,'sem_lance',null),(2672,'sem_lance',null),(2573,'sem_lance',null),(2718,'sem_lance',null),(2654,'sem_lance',null),
  (2714,'sem_lance',null),(2638,'sem_lance',null),(2675,'sem_lance',null),(2713,'sem_lance',null),(2572,'sem_lance',null),
  (2680,'sem_lance',null),(2707,'sem_lance',null),(2462,'sem_lance',null),(2320,'sem_lance',null),(2712,'sem_lance',null),
  (2668,'sem_lance',null),(2636,'sem_lance',null),(2710,'sem_lance',null),(2677,'sem_lance',null),(2647,'sem_lance',null),
  (2690,'sem_lance',null),(2657,'sem_lance',null),(2646,'sem_lance',null),(2700,'sem_lance',null),(2648,'sem_lance',null),
  (2662,'sem_lance',null),(2641,'sem_lance',null),(2670,'sem_lance',null),(2598,'sem_lance',null),(2674,'sem_lance',null),
  (2719,'sem_lance',null),(2679,'sem_lance',null),(2633,'sem_lance',null),(2649,'sem_lance',null),(2645,'sem_lance',null),
  (2653,'sem_lance',null),(2643,'sem_lance',null),(2689,'sem_lance',null),(2655,'sem_lance',null),(2717,'sem_lance',null),
  (2632,'sem_lance',null),(2667,'sem_lance',null),(2656,'sem_lance',null)
)
update public.imoveis_leilao i
   set resultado_leilao = v.resultado,
       valor_lance_vencedor = coalesce(v.valor, i.valor_lance_vencedor),
       resultado_apurado_em = now(),
       resultado_apuracao_tentativas = coalesce(i.resultado_apuracao_tentativas, 0) + 1,
       ativo = case when v.resultado = 'sem_lance' and not i.ativo and i.suprimido_motivo = 'praca_vencida' then true else i.ativo end,
       suprimido_motivo = case when v.resultado = 'sem_lance' and not i.ativo and i.suprimido_motivo = 'praca_vencida' then null else i.suprimido_motivo end
  from v
 where i.fonte = 'LEILAOELETRONICO'
   and substring(i.url_lote from '/lote/[^/]+/(\d+)/?$')::int = v.lote
   and i.data_fim >= date '2026-10-20' and i.data_fim < date '2026-10-30';
