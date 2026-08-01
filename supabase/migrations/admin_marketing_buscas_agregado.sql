-- Painel de Buscas (Admin → Marketing) congelado em "1000" (achado do dono, 01/08):
-- a tela puxava as linhas CRUAS de busca_historico p/ o navegador e o PostgREST corta
-- em 1.000 linhas por consulta → "Total de buscas" travava em 1000, "usuários únicos"
-- subcontava e cidades/estados eram rankeados numa fatia VELHA (as 1.000 linhas mais
-- antigas do período). Mesmo padrão do fix da demografia (admin_marketing_demografia):
-- agregar no servidor, numa chamada, escala p/ 10k+ usuários.

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
    )
    select jsonb_build_object(
      'total', (select count(*) from b),
      'unicos', (select count(distinct user_id) from b where user_id is not null),
      'cidades', (
        select coalesce(jsonb_agg(jsonb_build_array(cidade, n) order by n desc), '[]'::jsonb)
        from (select cidade, count(*)::int as n from b where cidade is not null group by cidade order by n desc limit 10) t
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
      )
    )
  );
end $function$;

revoke execute on function public.admin_marketing_buscas(timestamptz, timestamptz) from public, anon;
