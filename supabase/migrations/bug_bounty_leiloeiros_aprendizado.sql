-- "Bug bounty dos leiloeiros" — monitoramento AUTO-APRENDIDO (pedido do dono).
-- Lição do BIASI (369->26): pisos hardcoded em BASELINE_FONTES ficam obsoletos e alguém
-- precisa recalibrar na mão (foi preciso ajustar 150->120). Aqui o monitor passa a APRENDER
-- o "normal" de cada leiloeiro do próprio histórico — auto-calibra os ATUAIS e ONBOARDA
-- leiloeiros FUTUROS sem hardcode. Camadas:
--   1) fonte_metricas_hist: snapshot diário (cobertura + qualidade) por fonte — a base do
--      aprendizado (histórico rico p/ além do que o fonte_saude guarda).
--   2) snapshot_metricas_fontes(): grava o snapshot do dia (chamado pelo monitor-fontes-cron).
--   3) fonte_baseline_aprendida(): aprende, do fonte_saude (série de acervo por run), o PISO
--      de acervo de cada fonte = min(runs saudáveis) * 0.65. Usa o MÍNIMO (não percentil) p/
--      acompanhar quedas legítimas de acervo (auctions encerram) sem falso-positivo; a folga
--      de 35% pega só regressão GROSSA (o alvo: 369->26 silencioso). Só emite com >= p_min
--      amostras -> leiloeiro novo auto-onboarda após alguns runs.

-- 1) Histórico diário de métricas por fonte -----------------------------------------------
create table if not exists public.fonte_metricas_hist (
  fonte text not null,
  dia date not null default (now() at time zone 'utc')::date,
  ativos integer,
  foto integer, valor integer, area integer, data integer,
  matricula integer, edital integer, avaliacao integer,
  imovel_pct integer, ed_eq_matr integer, matr_eq_lote integer,
  primary key (fonte, dia)
);
-- RLS on + sem policy => só service_role (bypassa RLS) acessa; não exposto a anon/authenticated.
-- São métricas agregadas (sem PII), mas mantemos fechado por higiene.
alter table public.fonte_metricas_hist enable row level security;

-- 2) Snapshot do dia (idempotente por fonte/dia) ------------------------------------------
create or replace function public.snapshot_metricas_fontes()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n integer;
begin
  insert into public.fonte_metricas_hist as h
    (fonte, dia, ativos, foto, valor, area, data, matricula, edital, avaliacao, imovel_pct, ed_eq_matr, matr_eq_lote)
  select c.fonte, (now() at time zone 'utc')::date, c.ativos, c.foto, c.valor, c.area, c.data,
         c.matricula, c.edital, c.avaliacao, q.imovel_pct, q.ed_eq_matr, q.matr_eq_lote
  from public.fonte_cobertura() c
  left join public.fonte_qualidade() q on q.fonte = c.fonte
  on conflict (fonte, dia) do update set
    ativos=excluded.ativos, foto=excluded.foto, valor=excluded.valor, area=excluded.area,
    data=excluded.data, matricula=excluded.matricula, edital=excluded.edital,
    avaliacao=excluded.avaliacao, imovel_pct=excluded.imovel_pct,
    ed_eq_matr=excluded.ed_eq_matr, matr_eq_lote=excluded.matr_eq_lote;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke execute on function public.snapshot_metricas_fontes() from public, anon, authenticated;
grant execute on function public.snapshot_metricas_fontes() to service_role;

-- 3) Baseline APRENDIDA (piso de acervo por fonte, do histórico) ---------------------------
create or replace function public.fonte_baseline_aprendida(p_dias integer default 45, p_min integer default 3)
returns table(fonte text, n_amostras bigint, ativos_min integer, ativos_mediana integer, ativos_piso integer, tem_baseline boolean)
language sql set search_path to 'public' as $fn$
  with hist as (
    -- fonte_saude = série de acervo por run (escrita pelos scrapers). status ok = run saudável.
    select fonte, total::numeric as ativos
    from public.fonte_saude
    where executado_em > now() - (p_dias || ' days')::interval
      and status = 'ok' and total is not null and total > 0
  ),
  agg as (
    select fonte, count(*) as n, min(ativos) as vmin,
      percentile_cont(0.5) within group (order by ativos) as mediana
    from hist group by fonte
  )
  select fonte, n, round(vmin)::int, round(mediana)::int,
    greatest(round(vmin * 0.65)::int, 3), (n >= p_min)
  from agg;
$fn$;
revoke execute on function public.fonte_baseline_aprendida(integer,integer) from public, anon, authenticated;
grant execute on function public.fonte_baseline_aprendida(integer,integer) to service_role;
