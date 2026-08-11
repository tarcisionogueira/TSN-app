-- ============================================================================
-- PAINEL DE GEOCODIFICAÇÃO — 54 contagens viram 1 (11/08)
--
-- `carregarPendentes()` no Admin fazia, a cada abertura/refresh da tela:
--   27 UFs × 2 consultas `count: 'exact'` = 54 varreduras de `imoveis_leilao`
-- (56.126 linhas, 66 colunas, 180 MB), disparadas em paralelo. Mais 5 contagens no
-- fim de cada rodada de geocodificação por região e 3 no "geocodificar todos".
--
-- `count=exact` no PostgREST é COUNT(*) de verdade — não tem atalho. Cinquenta e quatro
-- deles ao mesmo tempo competem por conexão com o cliente que está buscando imóvel no
-- mesmo instante. Em produção, isso não é "o admin fica lento": é o banco ocupado.
--
-- Um `group by estado` responde tudo de uma vez, numa passada só.
-- ============================================================================

create or replace function public.geocod_pendentes()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select estado,
           count(*) filter (where latitude is not null and latitude <> 0) as com,
           count(*) filter (where latitude is null     or  latitude  = 0) as sem
      from imoveis_leilao
     -- MESMO filtro do painel: só acervo VIVO. Contar lote desativado inflava a tela
     -- para "mais de 50 mil imóveis" e punha lote morto na fila de geocodificação.
     where ativo
     group by estado
  )
  select jsonb_build_object(
    'com',    (select coalesce(sum(com), 0) from base),
    'sem',    (select coalesce(sum(sem), 0) from base),
    'por_uf', (select coalesce(jsonb_object_agg(estado, sem) filter (where estado is not null), '{}'::jsonb)
                 from base)
  );
$$;

comment on function public.geocod_pendentes() is
  'Contadores do painel de geocodificação numa varredura só (com/sem coordenada + pendentes por UF). '
  'Substitui 54 count=exact paralelos sobre imoveis_leilao. Criada em 11/08.';

revoke execute on function public.geocod_pendentes() from public, anon;
grant  execute on function public.geocod_pendentes() to authenticated, service_role;
