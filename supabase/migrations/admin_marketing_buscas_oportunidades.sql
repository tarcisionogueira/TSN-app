-- v2 do admin_marketing_buscas: soma a chave 'oportunidades' — p/ cada uma das top-10
-- cidades buscadas, a contagem REAL de imóveis ativos (o Mapa de Oportunidades contava
-- no navegador sobre um select cru de imoveis_leilao cortado em 1.000 linhas de 30k+
-- ativos → "Imóveis Disponíveis" saía errado p/ quase toda cidade). Join por nome
-- case-insensitive (mesma semântica do match exato que o front fazia, sem o corte).

create or replace function public.admin_marketing_buscas(p_inicio timestamp with time zone, p_fim timestamp with time zone)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return (
    with b as (
      select * from public.busca_historico
      where criado_em >= p_inicio and criado_em <= p_fim
    ),
    top_cidades as (
      select cidade, count(*)::int as n from b where cidade is not null
      group by cidade order by n desc limit 10
    )
    select jsonb_build_object(
      'total', (select count(*) from b),
      'unicos', (select count(distinct user_id) from b where user_id is not null),
      'cidades', (
        select coalesce(jsonb_agg(jsonb_build_array(cidade, n) order by n desc), '[]'::jsonb) from top_cidades
      ),
      'estados', (
        select coalesce(jsonb_agg(jsonb_build_array(estado, n) order by n desc), '[]'::jsonb)
        from (select estado, count(*)::int as n from b where estado is not null group by estado order by n desc limit 10) t
      ),
      'tipos', (
        select coalesce(jsonb_agg(jsonb_build_array(tipo_imovel, n) order by n desc), '[]'::jsonb)
        from (select tipo_imovel, count(*)::int as n from b where tipo_imovel is not null group by tipo_imovel order by n desc) t
      ),
      'pagamentos', (
        select coalesce(jsonb_agg(jsonb_build_array(pag, n) order by n desc), '[]'::jsonb)
        from (select p.pag, count(*)::int as n from b, unnest(b.pagamento_tipos) as p(pag) group by p.pag order by n desc) t
      ),
      'oportunidades', (
        select coalesce(jsonb_agg(jsonb_build_object('cidade', c.cidade, 'buscas', c.n, 'imoveis', c.imoveis) order by c.n desc), '[]'::jsonb)
        from (
          select tc.cidade, tc.n,
            (select count(*)::int from public.imoveis_leilao i where i.ativo and lower(i.cidade) = lower(tc.cidade)) as imoveis
          from top_cidades tc
        ) c
      )
    )
  );
end $function$;

revoke execute on function public.admin_marketing_buscas(timestamptz, timestamptz) from public, anon;
