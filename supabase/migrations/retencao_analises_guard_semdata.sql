-- Correção: o ramo "sem_data" da limpeza apagava QUALQUER análise com data_leilao NULL
-- e created_at > 60d, SEM a guarda de "imóvel ainda ativo com leilão futuro" que o ramo
-- "por_leilao" já tinha. Como o gerador DOCUMENTAL frequentemente grava data_leilao=null
-- (o cliente nem sempre envia a data no corpo), um relatório de imóvel com leilão FUTURO
-- podia ser apagado só por idade. Adiciona a MESMA guarda aos dois DELETEs sem_data.
create or replace function public.limpar_analises_orfas(p_dias int default 15, p_dias_sem_data int default 60)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  corte_leilao  date        := (now() - (p_dias || ' days')::interval)::date;
  corte_semdata timestamptz := now() - (p_dias_sem_data || ' days')::interval;
  m1 int; m2 int; d1 int; d2 int;
begin
  -- imóvel ainda ativo com leilão futuro → preserva a análise (re-agendado)
  with del as (
    delete from public.analises_mercado a
    where not a.arrematado and a.data_leilao is not null
      and a.data_leilao::date < corte_leilao
      and not exists (
        select 1 from public.imoveis_leilao i
        where i.id::text = a.imovel_id::text and i.ativo
          and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
          and i.data_leilao::date >= now()::date)
    returning 1
  ) select count(*) into m1 from del;

  with del as (
    delete from public.analises_mercado a
    where not a.arrematado and a.data_leilao is null and a.created_at < corte_semdata
      and not exists (
        select 1 from public.imoveis_leilao i
        where i.id::text = a.imovel_id::text and i.ativo
          and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
          and i.data_leilao::date >= now()::date)
    returning 1
  ) select count(*) into m2 from del;

  with del as (
    delete from public.analises_documental a
    where not a.arrematado and a.data_leilao is not null
      and a.data_leilao::date < corte_leilao
      and not exists (
        select 1 from public.imoveis_leilao i
        where i.id::text = a.imovel_id::text and i.ativo
          and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
          and i.data_leilao::date >= now()::date)
    returning 1
  ) select count(*) into d1 from del;

  with del as (
    delete from public.analises_documental a
    where not a.arrematado and a.data_leilao is null and a.created_at < corte_semdata
      and not exists (
        select 1 from public.imoveis_leilao i
        where i.id::text = a.imovel_id::text and i.ativo
          and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
          and i.data_leilao::date >= now()::date)
    returning 1
  ) select count(*) into d2 from del;

  return jsonb_build_object(
    'analises_mercado',    jsonb_build_object('por_leilao', m1, 'sem_data', m2),
    'analises_documental', jsonb_build_object('por_leilao', d1, 'sem_data', d2));
end
$function$;
