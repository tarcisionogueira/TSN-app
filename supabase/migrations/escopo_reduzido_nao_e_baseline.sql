-- ESCOPO REDUZIDO NÃO PODE VIRAR BASELINE NEM "ÚLTIMA MEDIÇÃO" (10/09, achado da revisão
-- geral dos scrapers pedida pelo dono).
--
-- `fonte_regressao_suspeita()` acusou GESTAOLEILOES: total=1 contra piso aprendido de 63,
-- status 'degradado'. O log real da execução (workflow_dispatch de 09/09) mostra a causa:
-- `GESTAO_DOMINIOS=granadoleiloes.com.br` (1 dos 5 domínios do cluster) e
-- `GESTAO_MAX_EVENTOS=2` (padrão é 25) — um TESTE PONTUAL, não uma coleta de produção. O dia
-- anterior (08/09) tinha 123 lotes saudáveis; o site nunca quebrou. `registrarSaude` comparou
-- o total do teste contra o histórico de escopo CHEIO e gravou `estrategia='principal'` —
-- indistinguível, para quem lê a tabela depois, de uma medição de verdade. É a forma nº10 do
-- CLAUDE.md: o instrumento mediu "o que um dispatch manual pediu", não "o que a fonte tem".
--
-- Fix (scraper-gestao.mjs, mesmo commit): `estrategia` ganha o sufixo `-escopo-reduzido`
-- quando o coletor sabe que rodou cortado. Esta migration ensina as duas funções SQL que já
-- filtram por `status` a filtrar TAMBÉM por esse sufixo — mesmo padrão do filtro existente
-- (`status not in ('sem_cota','parcial_cota')`), só que para o eixo "esta medição vale para
-- comparação" em vez de "esta medição teve sucesso". `estrategia='principal'` continua
-- servindo 23 outras fontes (BIASI, RJLEILOES, VLANCE, SUPERBID…) sem nenhuma mudança de
-- comportamento — o filtro só reconhece o sufixo novo, nunca o valor puro. Migration
-- 100% rebuildável do zero (só CREATE OR REPLACE FUNCTION); a correção pontual da ÚNICA
-- linha já contaminada por este incidente vive em migration separada.
begin;

create or replace function public.fonte_baseline_aprendida(p_dias integer DEFAULT 45, p_min integer DEFAULT 3)
 returns TABLE(fonte text, n_amostras bigint, ativos_min integer, ativos_mediana integer, ativos_piso integer, tem_baseline boolean)
 language sql
 set search_path to 'public'
as $function$
  with hist as (
    select fonte, coalesce(nullif(enumerados,0), total)::numeric as ativos
    from public.fonte_saude
    where executado_em > now() - (p_dias || ' days')::interval
      and status = 'ok' and coalesce(nullif(enumerados,0), total) > 0
      and estrategia not ilike '%escopo-reduzido%'
  ),
  agg as (
    select fonte, count(*) as n, min(ativos) as vmin,
      percentile_cont(0.5) within group (order by ativos) as mediana
    from hist group by fonte
  )
  select fonte, n, round(vmin)::int, round(mediana)::int,
    greatest(round(mediana * 0.5)::int, 3), (n >= p_min and mediana >= 20)
  from agg;
$function$;

create or replace function public.fonte_regressao_suspeita(p_dias_expiracao integer DEFAULT 7, p_horas_frescor integer DEFAULT 108)
 returns TABLE(fonte text, motivo text, total integer, ativos_piso integer, ativos_mediana integer, n_amostras bigint, status text, medido_em timestamp with time zone, horas_sem_medir integer, expirados_recentes bigint, faltando integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  with base as (
    select b.fonte, b.ativos_piso, b.ativos_mediana, b.n_amostras, b.tem_baseline
      from public.fonte_baseline_aprendida() b
  ),
  ultima as (
    select b.fonte, b.ativos_piso, b.ativos_mediana, b.n_amostras, b.tem_baseline,
           u.total, u.status, u.executado_em,
           round(extract(epoch from (now() - u.executado_em)) / 3600.0)::int as horas
      from base b
      join lateral (
        select coalesce(nullif(s.enumerados,0), s.total) as total, s.status, s.executado_em from public.fonte_saude s
         where s.fonte = b.fonte
           and s.status not in ('sem_cota', 'parcial_cota')
           and s.estrategia not ilike '%escopo-reduzido%'
         order by s.executado_em desc limit 1
      ) u on true
  ),
  expirados as (
    select i.fonte, count(*) as n
      from public.imoveis_leilao i
     where not i.ativo
       and i.atualizado_em > now() - (p_dias_expiracao || ' days')::interval
       and public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2)
     group by i.fonte
  ),
  avaliado as (
    select u.*, coalesce(e.n, 0) as exp_n,
      case
        when u.horas > p_horas_frescor then 'medicao_velha'
        when u.total = 0 and u.n_amostras >= 2 and u.ativos_mediana >= 3 then 'zerou'
        when u.n_amostras >= 3 and u.ativos_mediana >= 5
             and u.total + coalesce(e.n, 0) < u.ativos_piso then 'regressao'
      end as motivo
      from ultima u left join expirados e on e.fonte = u.fonte
  )
  select a.fonte, a.motivo, a.total, a.ativos_piso, a.ativos_mediana, a.n_amostras,
         a.status, a.executado_em, a.horas, a.exp_n,
         case when a.motivo = 'regressao'
              then (a.ativos_piso - a.total - a.exp_n::int) end as faltando
    from avaliado a
   where a.motivo is not null
   order by case a.motivo when 'zerou' then 1 when 'regressao' then 2 else 3 end,
            a.ativos_mediana desc;
$function$;

commit;
