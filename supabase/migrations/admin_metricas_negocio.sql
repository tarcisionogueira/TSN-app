-- Métricas de negócio para o Dashboard admin (cobertura de relatórios + pulso). SECURITY DEFINER
-- (agrega analises_* que têm RLS só-dono) com CHECK de admin interno; exposta só a authenticated
-- (nunca anon) — não é flagrada pelo auditoria_seguranca. Um round-trip só.
create or replace function public.admin_metricas_negocio()
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    'cobertura', (
      with todos as (
        select imovel_id, cidade, estado from public.analises_mercado where status='concluida'
        union all select imovel_id, cidade, estado from public.analises_documental where status='concluida'
        union all select imovel_id, cidade, estado from public.analises_laudo where status='concluida')
      select jsonb_build_object(
        'imoveis', count(distinct imovel_id),
        'cidades', count(distinct lower(cidade)) filter (where coalesce(cidade,'')<>''),
        'estados', count(distinct upper(estado)) filter (where coalesce(estado,'')<>''))
      from todos),
    'relatorios', jsonb_build_object(
      'mercado',      (select count(*) from public.analises_mercado    where status='concluida'),
      'documental',   (select count(*) from public.analises_documental where status='concluida'),
      'laudo',        (select count(*) from public.analises_laudo       where status='concluida'),
      'mercado_erro', (select count(*) from public.analises_mercado     where status='erro')),
    'amostras', (select coalesce(sum(
        (result->'mercado'->'nivel1'->>'totalAmostras')::int
      + (result->'mercado'->'nivel2'->>'totalAmostras')::int),0)
      from public.analises_mercado where status='concluida'),
    'buscas', jsonb_build_object(
      'total',          (select count(*) from public.busca_historico),
      'zero_resultado', (select count(*) from public.busca_historico where coalesce(resultados_count,0)=0),
      'ult_7d',         (select count(*) from public.busca_historico where criado_em > now()-interval '7 days')),
    'indice', jsonb_build_object(
      'cidades',     (select count(*) from public.cidade_indicadores where nivel='cidade'),
      'com_aluguel', (select count(*) from public.cidade_indicadores where aluguel_m2 is not null)),
    'gerado_em', now()
  );
end;
$fn$;
revoke execute on function public.admin_metricas_negocio() from public, anon;
grant execute on function public.admin_metricas_negocio() to authenticated;
