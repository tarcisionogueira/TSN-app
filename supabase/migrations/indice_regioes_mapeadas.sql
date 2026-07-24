-- Lista as CIDADES já mapeadas no índice (amostras de mercado), p/ o usuário navegar/consultar
-- direto (chips) em vez de adivinhar. Service-only (o endpoint /api/indice-mapeadas chama com
-- SERVICE_KEY). Reforça o UX "digite qualquer endereço/bairro/cidade e gere na hora".
create or replace function public.indice_regioes_mapeadas(p_limite integer default 40)
returns table (cidade_norm text, uf text, n_amostras int, tipos text)
language sql stable security definer set search_path to 'public'
as $function$
  select cidade_norm, uf,
         count(*)::int as n_amostras,
         string_agg(distinct tipo, ',') as tipos
  from public.indice_amostras
  where cidade_norm is not null and cidade_norm <> '' and uf is not null
  group by cidade_norm, uf
  having count(*) >= 3
  order by count(*) desc
  limit greatest(1, least(p_limite, 200));
$function$;

revoke all on function public.indice_regioes_mapeadas(integer) from public, anon, authenticated;
grant execute on function public.indice_regioes_mapeadas(integer) to service_role;

comment on function public.indice_regioes_mapeadas(integer) is 'Cidades já mapeadas no índice (indice_amostras), por volume de amostras. Service-only (endpoint /api/indice-mapeadas chama com SERVICE_KEY).';
