-- Escala (rumo a 10k usuários): índices que faltavam nos caminhos quentes.
-- 1) Busca por RAIO (buscar_por_raio_v2 + alerts cron ~18x/usuário) fazia FULL SCAN dos
--    ~33k imóveis ativos a cada chamada (earth_box @> ll_to_earth sem índice GiST).
create index if not exists idx_imoveis_earth
  on public.imoveis_leilao using gist (ll_to_earth(latitude::float8, longitude::float8))
  where ativo and latitude is not null and latitude <> 0;

-- 2) perfis.role: crons (alertas) e painéis filtram role=in.(...). Barato e necessário
--    quando a base sair de dezenas para milhares de linhas.
create index if not exists idx_perfis_role on public.perfis (role);
