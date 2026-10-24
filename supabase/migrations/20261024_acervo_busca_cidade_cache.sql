-- 24/10 (bug bounty, #318): acervo_busca_cidade reagregava imoveis_leilao inteiro a CADA busca pública
-- (147 ms e 18,6 mil buffers quente; com cache frio passou dos 8 s em 23/10 17:12 → 500 em /api/publico).
-- A lista de cidades muda devagar: vira cache diário em app_config.acervo_cidades, atualizado junto com
-- landing_numeros (monitor-fontes-cron). Cache ausente/ilegível = conta ao vivo, como antes.
create or replace function public.acervo_busca_cidade(p_q text)
 returns table(cidade text, cidade_norm text, uf text, total bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with q as (
    select lower(public.unaccent_simples(btrim(coalesce(p_q, '')))) as t
  ),
  cache as (
    select value::jsonb as v from public.app_config
     where key = 'acervo_cidades' and updated_at > now() - interval '3 days'
  ),
  cid as materialized (
    select r.k as cidade_norm, r.u as uf, r.c as cidade, r.n
      from cache, jsonb_to_recordset(cache.v) as r(k text, u text, c text, n bigint)
    union all
    select i.cidade_norm, upper(i.estado), i.cidade, count(*)
      from public.imoveis_leilao i
     where i.ativo and not exists (select 1 from cache)
     group by 1, 2, 3
  ),
  achados as (
    select c.* from cid c, q
     where length(q.t) >= 2
       and (c.cidade_norm like '%' || replace(q.t, ' ', '') || '%'
            or lower(public.unaccent_simples(c.cidade)) like '%' || q.t || '%')
  )
  select (array_agg(a.cidade order by a.n desc))[1] as cidade,
         a.cidade_norm, a.uf, sum(a.n)::bigint as total
    from achados a
   group by a.cidade_norm, a.uf
   order by sum(a.n) desc
   limit 40
$function$;

create or replace function public.landing_numeros_atualizar()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'imoveis', (select count(*) from imoveis_leilao where ativo),
    'veiculos', (select count(*) from veiculos_leilao where ativo),
    'leiloeiros', (select count(distinct lower(trim(l))) from (
        select leiloeiro l from imoveis_leilao where ativo
        union all select leiloeiro from veiculos_leilao where ativo) x where l is not null and trim(l) <> ''),
    'em', now())
    into v;
  insert into app_config (key, value, updated_at) values ('landing_numeros', v::text, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  -- 24/10: a lista de cidades da busca pública sai na mesma passada diária (dentro desta função, que já é
  -- só do service_role — uma função nova nasceria executável por anon).
  insert into app_config (key, value, updated_at)
  select 'acervo_cidades', coalesce(jsonb_agg(jsonb_build_object('k', cidade_norm, 'u', uf, 'c', cidade, 'n', n)), '[]'::jsonb)::text, now()
    from (select i.cidade_norm, upper(i.estado) as uf, i.cidade, count(*) as n
            from public.imoveis_leilao i where i.ativo group by 1, 2, 3) x
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $function$;

