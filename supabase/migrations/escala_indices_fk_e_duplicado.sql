-- ESCALA (rumo a 10k) — correções de índice apontadas pelos performance advisors.
-- Aplicado em produção via MCP (aditivo/seguro).
--
-- 1) Índice DUPLICADO em atividade_log: atividade_log_user_idx == idx_atividade_log_user_criado
--    (ambos btree (user_id, criado_em DESC)). Mantém idx_atividade_log_user_criado; dropa o outro
--    (reduz custo de escrita/vacuum na tabela de clickstream, alto volume de INSERT).
drop index if exists public.atividade_log_user_idx;

-- 2) FKs sem índice de cobertura (custo em cascade delete / JOIN conforme a base cresce).
create index if not exists idx_cota_concessoes_concedido_por on public.cota_concessoes (concedido_por);
create index if not exists idx_perfis_rank_key on public.perfis (rank_key);
