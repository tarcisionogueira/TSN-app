-- GATE de MATURIDADE do Índice BidPro POR CIDADE (liberação automática por cidade).
-- Quando uma cidade acumula dados de índice de RELATÓRIO suficientes (várias microrregiões
-- mapeadas por análises reais), ela fica "MADURA" e a feature FUTURA de comparativo
-- desconto (avaliação × leilão) × Índice BidPro é liberada AUTOMATICAMENTE ali — sem toggle
-- manual: o gerador só precisa checar cidade_indice_maduro() no momento do relatório.
-- Threshold tunável (default: 6 microrregiões de relatório na cidade).
-- Lê só public.cidade_indicadores (referência de mercado, sem PII) → NÃO precisa ser definer.

create or replace function public.cidade_indice_maduro(
  p_cidade_norm text, p_uf text, p_tipo text default 'residencial', p_min_micros integer default 6
) returns jsonb language sql stable set search_path to '' as $$
  with r as (
    select count(*) micros, coalesce(sum(n_amostras),0) amostras
    from public.cidade_indicadores
    where fonte='relatorio' and tipo=coalesce(nullif(p_tipo,''),'residencial')
      and cidade_norm=p_cidade_norm and uf=upper(p_uf) and nivel in ('bairro','grid')
  )
  select jsonb_build_object(
    'cidade_norm', p_cidade_norm, 'uf', upper(p_uf),
    'micros', micros, 'amostras', amostras, 'min_micros', p_min_micros,
    'cobertura_pct', least(100, round(micros::numeric / greatest(p_min_micros,1) * 100)),
    'maduro', micros >= p_min_micros)
  from r;
$$;

-- Lista/contagem das cidades já maduras (o "lembrete" vivo — dashboard/monitoramento).
create or replace function public.cidades_indice_maduras(
  p_min_micros integer default 6, p_tipo text default 'residencial'
) returns jsonb language sql stable set search_path to '' as $$
  with r as (
    select cidade_norm, uf, count(*) micros, coalesce(sum(n_amostras),0) amostras
    from public.cidade_indicadores
    where fonte='relatorio' and tipo=coalesce(nullif(p_tipo,''),'residencial') and nivel in ('bairro','grid')
    group by cidade_norm, uf
  )
  select jsonb_build_object(
    'min_micros', p_min_micros,
    'maduras', count(*) filter (where micros >= p_min_micros),
    'em_progresso', count(*) filter (where micros > 0 and micros < p_min_micros),
    'lista', coalesce(jsonb_agg(jsonb_build_object('cidade',cidade_norm,'uf',uf,'micros',micros,'amostras',amostras)
             order by micros desc) filter (where micros >= p_min_micros), '[]'::jsonb))
  from r;
$$;

revoke execute on function public.cidade_indice_maduro(text,text,text,integer) from public, anon;
revoke execute on function public.cidades_indice_maduras(integer,text) from public, anon;
grant execute on function public.cidade_indice_maduro(text,text,text,integer) to authenticated, service_role;
grant execute on function public.cidades_indice_maduras(integer,text) to authenticated, service_role;

-- Dashboard: adiciona a maturidade do índice às métricas (o lembrete que o dono vê).
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
    'indice_maturidade', public.cidades_indice_maduras(6, 'residencial'),
    'gerado_em', now()
  );
end;
$fn$;
