-- #305: recalcular_desconto_praca() custa ~80 ms com o heap no cache, mas lia ~19,5 mil páginas
-- (todo ativo via idx_imoveis_leilao_ativo) para filtrar 5,6 mil candidatos; com o heap frio isso
-- passava dos 8 s (57014 às 13:37 de 28/10, sem espera de lock no log — log_lock_waits está ligado).
-- Índice parcial com o MESMO predicado da função e as colunas da conta: a varredura fica num índice
-- de ~0,5 MB que mora no cache (19.459 → 2.173 páginas; 82 → 46 ms quente).
-- Se o predicado da função mudar, mudar aqui também (senão o planejador volta ao índice de ativo).
create index if not exists idx_il_desconto_praca_candidatos
  on public.imoveis_leilao (id)
  include (desconto_percentual, valor_avaliacao, valor_minimo, valor_minimo_2, data_leilao, data_leilao_2)
  where ativo
    and coalesce(valor_minimo_2,0) > 0 and coalesce(valor_minimo,0) > 0
    and valor_minimo_2 <> valor_minimo
    and coalesce(valor_avaliacao,0) > 0;
analyze public.imoveis_leilao;
