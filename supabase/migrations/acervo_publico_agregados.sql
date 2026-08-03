-- AGREGADOS DO ACERVO para as páginas públicas (SEO) — contagem feita no BANCO.
--
-- BUG QUE ISTO CORRIGE (pego na verificação da primeira publicação): a página /leiloes
-- anunciou "980 imóveis em 5 estados" quando o acervo tem 33.032 em 27 UFs. Causa: o endpoint
-- puxava as linhas com `select=estado&limit=100000` para contar no JavaScript — e o PostgREST
-- corta em 1.000 linhas (db-max-rows), sem erro nenhum. Voltaram as 1.000 primeiras, todas de
-- UFs iniciadas em A/B, e a conta saiu errada com cara de certa. É o MESMO padrão de falha já
-- corrigido nas telas do Admin: consulta crua com teto silencioso.
--
-- Correção estrutural, não paliativa: contar é trabalho do banco. Estas funções devolvem UM
-- valor jsonb (não um conjunto), então o teto de linhas do PostgREST não se aplica — a resposta
-- não pode ser truncada nem que o acervo dobre. E trafega alguns KB em vez de 33 mil linhas.
create or replace function public.acervo_uf_contagem()
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'total', n) order by n desc), '[]'::jsonb)
  from (
    select upper(estado) as uf, count(*) as n
      from public.imoveis_leilao
     where ativo and coalesce(estado,'') <> ''
     group by 1
  ) t;
$$;

create or replace function public.acervo_cidades_uf(p_uf text)
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('cidade', cidade, 'cidade_norm', cidade_norm, 'total', n) order by n desc), '[]'::jsonb)
  from (
    select min(cidade) as cidade, cidade_norm, count(*) as n
      from public.imoveis_leilao
     where ativo and upper(estado) = upper(p_uf)
       and coalesce(cidade_norm,'') <> '' and coalesce(cidade,'') <> ''
     group by cidade_norm
  ) t;
$$;

-- Esqueleto do sitemap: todo par UF/cidade com lote ativo.
create or replace function public.acervo_cidades_todas()
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'cidade_norm', cidade_norm)), '[]'::jsonb)
  from (
    select distinct upper(estado) as uf, cidade_norm
      from public.imoveis_leilao
     where ativo and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> ''
  ) t;
$$;

-- Uma fatia do sitemap de imóveis. Também devolve valor único: com `select=...&limit=5000` o
-- PostgREST entregaria só 1.000 e o mapa perderia 4 de cada 5 páginas — silenciosamente.
create or replace function public.acervo_sitemap_parte(p_offset integer, p_limite integer)
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'titulo', titulo, 'em', atualizado_em)), '[]'::jsonb)
  from (
    select id, titulo, atualizado_em
      from public.imoveis_leilao
     where ativo
     order by id
     offset greatest(coalesce(p_offset,0), 0)
     limit least(greatest(coalesce(p_limite,1000), 1), 20000)
  ) t;
$$;

create or replace function public.acervo_total_ativos()
returns integer
language sql
stable
security definer
set search_path = 'public'
as $$ select count(*)::int from public.imoveis_leilao where ativo; $$;

revoke all on function public.acervo_uf_contagem() from public, anon, authenticated;
revoke all on function public.acervo_cidades_uf(text) from public, anon, authenticated;
revoke all on function public.acervo_cidades_todas() from public, anon, authenticated;
revoke all on function public.acervo_sitemap_parte(integer,integer) from public, anon, authenticated;
revoke all on function public.acervo_total_ativos() from public, anon, authenticated;
grant execute on function public.acervo_uf_contagem() to service_role;
grant execute on function public.acervo_cidades_uf(text) to service_role;
grant execute on function public.acervo_cidades_todas() to service_role;
grant execute on function public.acervo_sitemap_parte(integer,integer) to service_role;
grant execute on function public.acervo_total_ativos() to service_role;
