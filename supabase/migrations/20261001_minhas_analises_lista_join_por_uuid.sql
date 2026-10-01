-- /analises TOMANDO STATEMENT TIMEOUT (01/10, Marcos — pagante — em erros_cliente às 02:38).
-- O join com o acervo comparava `i.id::text = p.imovel_id::text`. imoveis_leilao.id é UUID e o
-- cast no lado da tabela impede o uso da PK: cada abertura de /analises fazia SEQ SCAN em 83 mil
-- linhas / 291 MB — medido 1.673 ms para um usuário com 3 análises, e a tabela só cresce.
-- Agora o texto vira uuid (só quando TEM formato de uuid; senão NULL, que já não casava antes) e o
-- join usa imoveis_leilao_pkey: 0,3 ms no mesmo usuário. Semântica idêntica.
CREATE OR REPLACE FUNCTION public.minhas_analises_lista(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_alvo   uuid;
  v_role   text;
begin
  if v_caller is null then raise exception 'não autenticado'; end if;
  v_alvo := coalesce(p_user_id, v_caller);
  if v_alvo <> v_caller then
    select role into v_role from public.perfis where id = v_caller;
    if coalesce(v_role,'') not in ('admin','analista') then
      raise exception 'sem permissão para ler análises de outro usuário';
    end if;
  end if;

  return coalesce((
    with linhas as (
      select 1 as ord, 'mercado'::text as tipo, imovel_id, titulo, cidade, estado, imovel,
             status, data_leilao, arrematado, updated_at, created_at,
             jsonb_build_object('temResultado', result is not null) as flags
        from public.analises_mercado where user_id = v_alvo
      union all
      select 2, 'documental', imovel_id, titulo, cidade, estado, imovel,
             status, data_leilao, arrematado, updated_at, created_at,
             jsonb_build_object(
               'precisaDocumentos', coalesce(result->'precisaDocumentos', 'false'::jsonb),
               'emCaptura',         coalesce(result->'emCaptura', 'false'::jsonb),
               'nivelRisco',        result->>'nivelRisco')
        from public.analises_documental where user_id = v_alvo
      union all
      select 3, 'laudo', imovel_id, titulo, cidade, estado, imovel,
             status, data_leilao, arrematado, updated_at, created_at,
             jsonb_build_object(
               'precisaRelatorios', coalesce(result->'precisaRelatorios', 'false'::jsonb),
               'veredito',          result->>'veredito')
        from public.analises_laudo where user_id = v_alvo
    ),
    porim as (
      select imovel_id,
             (array_agg(titulo order by ord) filter (where coalesce(titulo,'') <> ''))[1] as titulo,
             (array_agg(cidade order by ord) filter (where coalesce(cidade,'') <> ''))[1] as cidade,
             (array_agg(estado order by ord) filter (where coalesce(estado,'') <> ''))[1] as estado,
             (array_agg(imovel order by ord) filter (where imovel is not null))[1]        as imovel,
             max(data_leilao)                 as praca_analise,
             max(updated_at)                  as updated_at,
             min(created_at)                  as created_at,
             bool_or(arrematado)              as arrematado,
             jsonb_object_agg(tipo, jsonb_build_object('status', status, 'flags', flags)) as relatorios
        from linhas group by imovel_id
    ),
    comp as (
      select p.*, i.ativo as imovel_ativo,
             (select max(x) from (values
                ((nullif(i.data_leilao, ''))::timestamptz),
                (i.data_leilao_2),
                (i.data_fim::timestamptz + interval '1 day' - interval '1 second')
              ) v(x)) as praca_acervo
        from porim p
        left join public.imoveis_leilao i
          on i.id = (case when p.imovel_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          then p.imovel_id::text::uuid end)
    )
    select jsonb_agg(jsonb_build_object(
             'imovelId',    imovel_id,
             'titulo',      titulo,
             'cidade',      cidade,
             'estado',      estado,
             'imovel',      imovel,
             'dataLeilao',  nullif(greatest(coalesce(praca_acervo,'-infinity'::timestamptz),
                                            coalesce(praca_analise,'-infinity'::timestamptz)),
                                   '-infinity'::timestamptz),
             'imovelAtivo', coalesce(imovel_ativo, false),
             'arrematado',  coalesce(arrematado, false),
             'updatedAt',   updated_at,
             'createdAt',   created_at,
             'relatorios',  relatorios)
           order by updated_at desc)
      from comp
  ), '[]'::jsonb);
end;
$function$;
