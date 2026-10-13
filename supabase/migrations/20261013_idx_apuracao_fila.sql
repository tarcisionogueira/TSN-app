-- 13/10 — fila do apurar-resultado-leilao-cron estourava o statement_timeout (8 s) do service_role.
-- A consulta filtra (ativo OR suprimido_motivo='praca_vencida') e (resultado_leilao IS NULL OR
-- ='indeterminado'): nenhum dos índices parciais existentes (WHERE ativo / WHERE resultado_leilao
-- IS NULL) é implicado por esses OR, e o plano caía em seq scan — 10,2 s medidos fora do pico.
-- Este índice tem o predicado igual ao filtro do cron, então o planner o usa pelo intervalo de data_fim.
create index if not exists imoveis_leilao_fila_apuracao_idx
  on public.imoveis_leilao (data_fim)
  where (resultado_leilao is null or resultado_leilao = 'indeterminado');
