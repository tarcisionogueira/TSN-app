-- Fila de veículos LJUD sem data (05/10, #98): quem foi lido e não tinha rótulo de encerramento
-- vai para o fim da fila — ordenar só por atualizado_em fazia os mesmos 75 serem relidos todo dia.
alter table public.veiculos_leilao add column if not exists data_lida_em timestamptz;
