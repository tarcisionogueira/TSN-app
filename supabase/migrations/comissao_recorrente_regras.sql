-- Motor de comissão recorrente (regras do dono):
--  comissionado_por: no CLIENTE, quem ganha comissão sobre as mensalidades dele
--    (consultor OU afiliado). Separado de indicado_por (carteira/care do consultor;
--    afiliado não cuida do cliente).
--  comissionamento_bloqueado: no VENDEDOR, perda PERMANENTE de comissão (ao desativar
--    a conta, ou após ~3 meses sem indicar). Não volta ao reativar.
--  ultima_indicacao_em: no VENDEDOR, data da última indicação nova (regra dos 3 meses).
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS comissionado_por          uuid REFERENCES public.perfis(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS comissionamento_bloqueado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ultima_indicacao_em       timestamptz;

CREATE INDEX IF NOT EXISTS idx_perfis_comissionado_por ON public.perfis(comissionado_por) WHERE comissionado_por IS NOT NULL;
