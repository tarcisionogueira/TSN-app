-- 28/10 (pendência 305): com o relistados consertado em 27/10, o passo seguinte do cron
-- desativar-encerrados passou a estourar: recalcular_desconto_praca() deu 57014 às 21:37 e
-- 22:37 UTC de 27/10. pg_stat_statements: 80 chamadas, média 2,3 s, pico 8,0 s.
--
-- Medido em 28/10 com EXPLAIN (ANALYZE, BUFFERS), como SELECT do mesmo filtro (zero linhas a mudar):
--   função atual ............ 11,4 s
--   só o filtro de colunas .. 0,06 s (5.270 candidatos de 35,4 mil ativos, tudo em cache)
-- O custo é desconto_da_praca_mais_descontada(), chamada DUAS vezes por candidato (no
-- `is distinct from` e no `is not null`), cada uma chamando lance_praca_mais_descontada(), com
-- cast de texto para timestamptz. As duas são SQL STABLE, mas têm `SET search_path` — função com
-- cláusula SET nunca é embutida pelo planejador, então cada linha paga duas trocas de contexto
-- de função aninhada (~1 ms por chamada).
--
-- Conserto: a mesma conta escrita direto no UPDATE e calculada uma vez por linha.
--   - lance = menor valor entre as praças ainda disponíveis (data nula ou >= now()); se nenhuma
--     estiver disponível, o menor das duas (igual a lance_praca_mais_descontada);
--   - desconto = nulo se lance <= 0 ou > 1,5 × avaliação; senão round((1 − lance/avaliação) × 100)
--     (igual a desconto_da_praca_mais_descontada).
-- Conferido em 28/10 contra a função atual: 5.270 de 5.270 iguais, incluindo 42 com só uma praça
-- futura, 24 com as duas vencidas e 4 nulos. Mesmo SELECT: 0,07 s.
--
-- As duas funções auxiliares continuam (gatilho de escrita e quem mais as chame); só esta varredura
-- deixa de usá-las. Se a regra do desconto mudar, mudar nos dois lugares.

CREATE OR REPLACE FUNCTION public.recalcular_desconto_praca()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  with c as (
    select i.id, i.desconto_percentual as dp, i.valor_avaliacao as a,
           i.valor_minimo as v1, i.valor_minimo_2 as v2,
           (nullif(i.data_leilao, ''))::timestamptz as d1, i.data_leilao_2 as d2
      from public.imoveis_leilao i
     where i.ativo
       and coalesce(i.valor_minimo_2,0) > 0 and coalesce(i.valor_minimo,0) > 0
       and i.valor_minimo_2 <> i.valor_minimo
       and coalesce(i.valor_avaliacao,0) > 0
  ), l as (
    select id, dp, a,
           case when (d1 is null or d1 >= now()) and (d2 is null or d2 >= now()) then least(v1, v2)
                when (d1 is null or d1 >= now()) then v1
                when (d2 is null or d2 >= now()) then v2
                else least(v1, v2) end as lance
      from c
  ), n as (
    select id, dp,
           case when lance <= 0 or lance > a * 1.5 then null
                else round((1 - lance / a) * 100)::integer end as novo
      from l
  )
  update public.imoveis_leilao i
     set desconto_percentual = n.novo
    from n
   where i.id = n.id
     and n.novo is not null
     and n.dp is distinct from n.novo;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
