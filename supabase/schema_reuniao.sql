-- Adiciona data/hora e duração da reunião às solicitações
ALTER TABLE public.solicitacoes
  ADD COLUMN IF NOT EXISTS reuniao_em          timestamptz,
  ADD COLUMN IF NOT EXISTS reuniao_duracao_min integer DEFAULT 60;
