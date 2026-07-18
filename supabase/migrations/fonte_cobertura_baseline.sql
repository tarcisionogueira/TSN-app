-- Linha de base da captura (docs/BASELINE_CAPTURA_LEILOEIROS.md): RPC de cobertura por
-- fonte para o monitor comparar o acervo vivo com o baseline e pegar REGRESSÃO SILENCIOSA
-- (scraper roda mas encolhe / perde um campo que vinha 100%). Só o monitor (service key)
-- chama — sem grant a anon/authenticated, SECURITY INVOKER (não é flagrada pelo auditor).
create or replace function public.fonte_cobertura()
returns table (
  fonte text,
  ativos bigint,
  foto int,
  valor int,
  area int,
  data int,
  matricula int,
  edital int,
  avaliacao int
)
language sql
security invoker
set search_path = public
as $$
  select
    fonte,
    count(*) as ativos,
    round(100.0*count(*) filter (where link_foto      is not null and link_foto      <> '')/count(*))::int,
    round(100.0*count(*) filter (where valor_minimo   is not null and valor_minimo   >  0 )/count(*))::int,
    round(100.0*count(*) filter (where area_m2        is not null and area_m2        >  0 )/count(*))::int,
    round(100.0*count(*) filter (where data_leilao    is not null and data_leilao    <> '')/count(*))::int,
    round(100.0*count(*) filter (where link_matricula is not null and link_matricula <> '')/count(*))::int,
    round(100.0*count(*) filter (where link_edital    is not null and link_edital    <> '')/count(*))::int,
    round(100.0*count(*) filter (where valor_avaliacao is not null and valor_avaliacao > 0 )/count(*))::int
  from imoveis_leilao
  where ativo = true
  group by fonte;
$$;

revoke all on function public.fonte_cobertura() from public;
grant execute on function public.fonte_cobertura() to service_role;
