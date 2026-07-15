-- Retenção de análises com GUARDA de re-agendamento.
-- Regra mantida: análise não-arrematada é apagada 15d após o leilão (ou 60d sem data);
-- arrematada nunca apaga. NOVO: não apaga se o imóvel segue ATIVO e com data_leilao
-- FUTURA (2ª praça / re-agendamento) — senão o relatório sumia com o imóvel ainda
-- listado e analisável. Substitui os DELETEs soltos do cron por uma RPC atômica.
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
    returning 1
  ) select count(*) into d2 from del;

  return jsonb_build_object(
    'analises_mercado',    jsonb_build_object('por_leilao', m1, 'sem_data', m2),
    'analises_documental', jsonb_build_object('por_leilao', d1, 'sem_data', d2));
end
$function$;