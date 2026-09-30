-- 30/09 — `fonte_regressao_suspeita()`: o vazio DECLARADO pelo site também não é "regressão".
-- O conserto de 29/09 (fonte_regressao_zero_declarado_pelo_site) tirou a exceção só do ramo
-- 'zerou'. Um total 0 com o site declarando "nenhum lote encontrado" caía no ramo seguinte
-- ('regressao', 0 < piso) e a HASTA (vazia na origem, conferida em todo evento) seguia acusando
-- "faltando 290". Mesma cláusula nos dois ramos. Nada mais muda.
create or replace function public.fonte_regressao_suspeita(p_dias_expiracao integer default 7, p_horas_frescor integer default 108)
 returns table(fonte text, motivo text, total integer, ativos_piso integer, ativos_mediana integer, n_amostras bigint, status text, medido_em timestamp with time zone, horas_sem_medir integer, expirados_recentes bigint, faltando integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  with base as (
    select b.fonte, b.ativos_piso, b.ativos_mediana, b.n_amostras, b.tem_baseline
      from public.fonte_baseline_aprendida() b
     where not exists (
       select 1 from public.leiloeiro_conhecimento lc
        where lc.fonte = b.fonte and lc.suspenso
     )
  ),
  ultima as (
    select b.fonte, b.ativos_piso, b.ativos_mediana, b.n_amostras, b.tem_baseline,
           u.total, u.status, u.executado_em, u.motivo as motivo_saude,
           round(extract(epoch from (now() - u.executado_em)) / 3600.0)::int as horas
      from base b
      join lateral (
        select coalesce(nullif(s.enumerados,0), s.total) as total, s.status, s.executado_em, s.motivo from public.fonte_saude s
         where s.fonte = b.fonte
           and s.status not in ('sem_cota', 'parcial_cota')
           and s.estrategia not ilike '%escopo-reduzido%'
         order by s.executado_em desc limit 1
      ) u on true
  ),
  intervalos as (
    select s.fonte,
           extract(epoch from s.executado_em - lag(s.executado_em) over (partition by s.fonte order by s.executado_em)) / 3600.0 as h
      from public.fonte_saude s
     where s.status not in ('sem_cota', 'parcial_cota')
       and s.estrategia not ilike '%escopo-reduzido%'
       and s.executado_em > now() - interval '45 days'
  ),
  cadencia as (
    select i.fonte,
           least(264, greatest(p_horas_frescor, ceil(1.5 * percentile_cont(0.5) within group (order by i.h))))::int as limite_h
      from intervalos i
     where i.h > 2
     group by i.fonte
    having count(*) >= 3
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
        when u.horas > coalesce(c.limite_h, p_horas_frescor) then 'medicao_velha'
        when u.total = 0 and u.n_amostras >= 2 and u.ativos_mediana >= 3 and coalesce(u.motivo_saude, '') not ilike 'site declara%' then 'zerou'
        when u.n_amostras >= 3 and u.ativos_mediana >= 5
             and u.total + coalesce(e.n, 0) < u.ativos_piso
             and coalesce(u.motivo_saude, '') not ilike 'site declara%' then 'regressao'
      end as motivo
      from ultima u
      left join expirados e on e.fonte = u.fonte
      left join cadencia c on c.fonte = u.fonte
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
