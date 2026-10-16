-- processo_fluxo_estatistica: de 13,6 s para 0,4 s (16/10).
--
-- POR QUE: a CTE `ate_decisao` buscava "a próxima decisão depois deste movimento" com uma
-- subconsulta correlacionada sobre a CTE `e` INTEIRA — 3.889 movimentos de conclusão/decisão
-- × 16 mil movimentos ≈ 63 milhões de comparações. Com 16.294 movimentos a função levava
-- 13,6 s e o `authenticator` corta em 8 s: TODA chamada vinda da API terminava em
-- "statement timeout" (5 no log de 24 h), e `api/_previsao-processo.js` ficava sem a base
-- da plataforma — o vazio chegava à previsão do processo no relatório.
--
-- COMO: a mesma pergunta virou uma janela por processo — o menor `data` de decisão
-- ESTRITAMENTE posterior (`range between 1 day following`, `data` é date) — calculada na
-- mesma passada do `lead()`. Conferido em seco antes de aplicar: 69 linhas, zero diferença
-- nos dois sentidos (EXCEPT antigo×novo e novo×antigo).
CREATE OR REPLACE FUNCTION public.processo_fluxo_estatistica(p_justica text DEFAULT NULL::text)
 RETURNS TABLE(de text, para text, n integer, prob numeric, p25 integer, mediana integer, p75 integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with m as (
    select numero_processo, data, public.movimento_classe(codigo, descricao) as classe
      from processo_movimentos
     where p_justica is null or public.justica_do_numero(numero_processo) = p_justica
  ),
  e as (select distinct numero_processo, data, classe from m where classe <> 'outro'),
  seq as (
    select numero_processo, data, classe,
           lead(classe) over w as prox, lead(data) over w as prox_data,
           min(data) filter (where classe = 'decisao') over (partition by numero_processo order by data
                 range between interval '1 day' following and unbounded following) as prox_decisao
      from e window w as (partition by numero_processo order by data, classe)
  ),
  imediatas as (
    select classe as de, prox as para, (prox_data - data) as dias
      from seq where prox is not null and prox <> classe
  ),
  ate_decisao as (
    select classe as de, 'decisao_seguinte'::text as para, (prox_decisao - data) as dias
      from seq where classe in ('conclusao', 'decisao')
  ),
  tudo as (select * from imediatas union all select * from ate_decisao where dias is not null)
  select t.de, t.para, count(*)::int,
         case when t.para = 'decisao_seguinte' then null
              else round(count(*)::numeric / nullif(sum(count(*)) filter (where t.para <> 'decisao_seguinte') over (partition by t.de), 0), 3) end,
         percentile_disc(0.25) within group (order by t.dias)::int,
         percentile_disc(0.5)  within group (order by t.dias)::int,
         percentile_disc(0.75) within group (order by t.dias)::int
    from tudo t group by t.de, t.para;
$function$;
