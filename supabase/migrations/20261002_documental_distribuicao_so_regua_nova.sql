-- 02/10 — documental_distribuicao() media a régua ANTIGA e reportava como a atual (forma nº 10).
--
-- O ritual de 02/10 leu "SATURANDO: 93% amarelo · confiança média" e quase virou trabalho em cima
-- da régua nova de 01/10 21:38 (67bbc24: risco calculado pelo SERVIDOR + trava de liberação).
-- Medido: NENHUM dos 14 relatórios da amostra saiu da régua nova. O filtro `confianca is not null`
-- separava "pré-31/08" de "pós-31/08", mas `confianca` já existia desde 31/08 — então a régua de
-- 31/08 (a que a de 01/10 veio substituir) era contada como amostra da atual. Os 3 com updated_at
-- depois de 01/10 21:38 também são antigos: regeração leu 0 documentos e PRESERVOU o parecer anterior.
--
-- Agora há três blocos, e só a régua 2 entra no veredito:
--   régua 2 = result tem `reguaVersao` (gravado desde 02/10) ou `documentosNaoLidos` (campo que a
--             régua de 01/10 sempre grava — cobre o que saiu entre 01/10 21:38 e o marcador);
--   régua 1 = `confianca` preenchida sem as marcas acima (31/08 → 01/10) — fora da conta, com a
--             célula dominante no detalhe, para comparação;
--   TRAVA   = liberação bloqueada (sem risco/confiança: faltou documento ou processo);
--   LEGADO  = confianca nula (pré-31/08) — fora da conta, como antes.
create or replace function public.documental_distribuicao()
 returns table(bloco text, chave text, qtd text, pct text, detalhe text)
 language sql stable security definer set search_path to 'public'
as $function$
with base as (
  select
    d.result->>'nivelRisco'                              as risco,
    d.result->>'confianca'                               as confianca,
    case when coalesce((d.result->>'bloqueioLiberacao')::boolean, false) then -1
         when d.result ? 'reguaVersao' or d.result ? 'documentosNaoLidos' then 2
         when d.result->>'confianca' is not null then 1 else 0 end as regua,
    coalesce(jsonb_array_length(d.result->'riscos'), 0)  as riscos,
    (select count(*) from jsonb_array_elements(coalesce(d.result->'riscos','[]'::jsonb)) r
      where (r->>'constaNaDoc')::boolean is true)        as confirmados
  from analises_documental d
  where d.status = 'concluida' and d.result is not null
),
novo as (select * from base where regua = 2),
n as (select count(*)::numeric as total from novo)
select 'CELULA',
       risco || ' · confianca ' || confianca,
       count(*)::text,
       round(100.0 * count(*) / nullif((select total from n), 0))::text || '%',
       'riscos ' || round(avg(riscos), 1) || ' · confirmados ' || round(avg(confirmados), 1)
  from novo group by 1, 2
union all
select 'VEREDITO', 'amostra (regua de 01/10)', (select total from n)::text, null,
       case when (select total from n) < 5
            then 'AMOSTRA INSUFICIENTE (min. 5) — o teste abaixo nao vale ainda'
            else 'amostra suficiente' end
union all
select 'VEREDITO', 'celulas ocupadas (de 9)',
       count(distinct risco || confianca)::text,
       round(100.0 * max(c) / nullif((select total from n), 0))::text || '% na maior',
       case
         when (select total from n) < 5                      then '(aguardando amostra)'
         when count(distinct risco || confianca) <= 1        then 'TRAVADO: uma saida so — nao classifica'
         when 100.0 * max(c) / (select total from n) > 80    then 'SATURANDO: >80% numa celula so'
         else 'OK: esta discriminando' end
  from (select risco, confianca, count(*) c from novo group by 1, 2) x
union all
select 'REGUA 1', 'regua de 31/08 (substituida em 01/10)',
       count(*)::text, null,
       'fora da conta acima · maior celula: ' || coalesce((select risco || ' · ' || confianca || ' (' || count(*) || ')'
         from base where regua = 1 group by risco, confianca order by count(*) desc limit 1), '-')
  from base where regua = 1
union all
select 'TRAVA', 'liberacao bloqueada (regra do dono, 01/10)',
       count(*)::text, null, 'sem classificacao: faltou documento/processo — fora da conta acima'
  from base where regua = -1
union all
select 'LEGADO', 'anteriores a 31/08 (confianca nula)',
       count(*)::text, null, 'fora da conta acima'
  from base where regua = 0
order by 1, 3 desc;
$function$;
