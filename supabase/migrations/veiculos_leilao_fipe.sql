-- 20/09: valor FIPE de referência para veículos em leilão (pedido do dono — "saber do valor
-- real do carro no dia de hoje"). Fonte: API pública gratuita da FIPE (fipe.parallelum.com.br,
-- projeto deividfortuna/fipe, ~10 anos no ar), 500 requisições/dia sem token. Casamento
-- marca/modelo/ano é aproximado (nosso `marca`/`modelo` vem livre da fonte, a FIPE usa nome
-- completo do modelo: "Gol (novo) 1.0 Mi Total Flex 8V 2p") — por isso `fipe_status` distingue
-- 'ok' (casamento único) de 'aproximado' (mais de uma versão bateu no ano; pegamos a 1ª de
-- forma determinística, valor é indicativo) de 'sem_match' (marca/modelo não achado na FIPE).
-- Preenchido por scripts/enriquecer-fipe.mjs (cron), nunca no fluxo de captura — a FIPE só
-- atualiza a tabela uma vez por mês, não faz sentido chamar a cada scrape.
ALTER TABLE public.veiculos_leilao
  ADD COLUMN IF NOT EXISTS valor_fipe numeric,
  ADD COLUMN IF NOT EXISTS fipe_codigo text,
  ADD COLUMN IF NOT EXISTS fipe_mes_referencia text,
  ADD COLUMN IF NOT EXISTS fipe_status text,
  ADD COLUMN IF NOT EXISTS fipe_atualizado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_veiculos_leilao_fipe_pendente
  ON public.veiculos_leilao (fipe_atualizado_em)
  WHERE ativo AND marca IS NOT NULL AND modelo IS NOT NULL AND ano_fabricacao IS NOT NULL;
