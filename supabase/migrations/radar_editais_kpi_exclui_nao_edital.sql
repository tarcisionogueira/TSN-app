-- Radar de Editais — HONESTIDADE DOS KPIs: excluir os 'nao_edital' (a IA já confirmou que NÃO são
-- edital de leilão) das contagens e da lista. Antes inflavam ~23% o "Editais" e apareciam na tabela.
-- erro_parse continua contando (é edital real que o parser não conseguiu ler → trabalho a recuperar).
create or replace function public.admin_radar_editais(p_dias integer default 30, p_so_nao_integrado boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'kpis', (
      select jsonb_build_object(
        'total', count(*),
        'novos_7d', count(*) filter (where data_disponibilizacao > (now()-interval '7 days')::date),
        'leiloeiros_distintos', count(distinct leiloeiro_nome_norm),
        'nao_integrados', count(*) filter (where not leiloeiro_integrado),
        'ja_no_acervo', count(*) filter (where leiloeiro_integrado),
        'erro_parse', count(*) filter (where status = 'erro_parse')
      )
      from public.editais_leilao
      where data_disponibilizacao > (now() - (p_dias || ' days')::interval)::date
        and status is distinct from 'nao_edital'          -- IA já descartou como não-edital
    ),
    'editais', coalesce((
      select jsonb_agg(to_jsonb(e) - 'texto_integral' - 'payload' order by e.data_disponibilizacao desc, e.criado_em desc)
      from (
        select * from public.editais_leilao
        where data_disponibilizacao > (now() - (p_dias || ' days')::interval)::date
          and status is distinct from 'nao_edital'
          and (not p_so_nao_integrado or not leiloeiro_integrado)
        order by data_disponibilizacao desc, criado_em desc
        limit 300
      ) e
    ), '[]'::jsonb)
  );
end $fn$;
revoke execute on function public.admin_radar_editais(integer, boolean) from public, anon;
grant execute on function public.admin_radar_editais(integer, boolean) to authenticated;
