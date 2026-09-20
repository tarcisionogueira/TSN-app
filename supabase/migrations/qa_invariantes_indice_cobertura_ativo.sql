-- 20/09: qa_invariantes_lenta alertava (7-8s no servidor, ms_servidor consistente acima do
-- teto de 5000 por pelo menos uma semana — "índice pendente" já anotado no HANDOFF). Achado
-- via EXPLAIN ANALYZE: qa_invariantes() tem ~15 subconsultas INDEPENDENTES, cada uma
-- `select count(*) from imoveis_leilao where ativo and <condição>` — e CADA UMA paga o MESMO
-- custo isolado (Index Scan em idx_imoveis_leilao_ativo, ~14.687 buffers / 30-70ms) porque o
-- índice existente em `ativo` não cobre as colunas filtradas, forçando heap fetch por linha
-- ativa (27.144 linhas) em CADA subconsulta. Índice de cobertura (INCLUDE) permite index-only
-- scan para as subconsultas mais simples (sem_foto, sem_cidade, aval_incoerente,
-- valor_sentinela, desconto_ge90, venda_direta_com_praca) sem reescrever a função — mudança
-- puramente aditiva, sem risco de alterar o resultado de nenhum invariante.
CREATE INDEX IF NOT EXISTS idx_imoveis_ativo_covering ON public.imoveis_leilao (ativo)
  INCLUDE (link_foto, cidade, estado, valor_avaliacao, valor_minimo, desconto_percentual, modalidade, data_leilao, forma_pagamento)
  WHERE ativo;
