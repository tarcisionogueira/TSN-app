-- fonte_regressao_suspeita() tratava "cron suspenso de propósito" como "esquecido": o
-- EMILIOMATOS foi desligado em 29/08 (o cron grava lote de OUTRO leiloeiro — catálogo
-- multi-tenant do Superbid, ver comentário em .github/workflows/scraper-emiliomatos.yml)
-- e a função gritava "medicao_velha" a cada rodada, porque não tem como distinguir uma
-- decisão registrada de um abandono. Suspensão de propósito não é regressão.
--
-- `leiloeiro_conhecimento` ganha a marca (dado, não comentário — mesmo princípio de
-- `regra_negocio`), e a função passa a excluir fonte suspensa do alarme.

alter table public.leiloeiro_conhecimento
  add column if not exists suspenso boolean not null default false,
  add column if not exists suspenso_motivo text,
  add column if not exists suspenso_em timestamptz;

update public.leiloeiro_conhecimento
   set suspenso = true,
       suspenso_motivo = 'Cron suspenso em 29/08: catálogo multi-tenant do Superbid grava lote de OUTRO leiloeiro sob esta fonte (ver .github/workflows/scraper-emiliomatos.yml). Fica suspenso até um recon achar a rota que lista só o acervo do leiloeiro.',
       suspenso_em = '2026-08-29 02:07:29+00'
 where fonte = 'EMILIOMATOS' and not suspenso;

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
