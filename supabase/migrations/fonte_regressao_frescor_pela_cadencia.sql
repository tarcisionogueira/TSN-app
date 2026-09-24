-- ─────────────────────────────────────────────────────────────────────────────────────────
-- fonte_regressao_suspeita: "medição velha" julgada pela CADÊNCIA APRENDIDA da fonte — 24/09
--
-- O teto fixo de 108 h (= MAX_IDADE_H do monitor-fontes-cron) acusava toda semana a LEFFA, cuja
-- coleta é SEMANAL por desenho (mediana de 172 h entre medições reais): o alarme acende no 5º
-- dia e fica aceso até a próxima coleta, sem haver nada errado. Alarme que acende sempre ensina
-- a ignorá-lo — é o mesmo princípio de "auto-calibra, sem hardcode" do piso de acervo.
--
-- Regra: limite = max(108 h, 1,5 × mediana do intervalo entre medições reais nos últimos
-- 45 dias), com TETO de 264 h (11 dias) — cadência mais lenta que isso não é cadência, é
-- abandono. Exige 3+ intervalos para aprender; abaixo disso vale o padrão de 108 h. Medições
-- `sem_cota`/`parcial_cota`/escopo-reduzido NÃO contam (mesmo filtro da última medição): uma
-- fonte travada no freio de orçamento continua acusando — "não consigo verificar" é linha.
-- Dry-run 24/09: LEFFA 258 h; cluster SOLEON/GESTAO ~110 h (TORRES3, sem medição real desde
-- 18/09, segue acusando — corretamente).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fonte_regressao_suspeita(p_dias_expiracao integer default 7, p_horas_frescor integer default 108)
 returns table(fonte text, motivo text, total integer, ativos_piso integer, ativos_mediana integer, n_amostras bigint, status text, medido_em timestamp with time zone, horas_sem_medir integer, expirados_recentes bigint, faltando integer)
 language sql stable set search_path to 'public'
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
        when u.total = 0 and u.n_amostras >= 2 and u.ativos_mediana >= 3 then 'zerou'
        when u.n_amostras >= 3 and u.ativos_mediana >= 5
             and u.total + coalesce(e.n, 0) < u.ativos_piso then 'regressao'
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
