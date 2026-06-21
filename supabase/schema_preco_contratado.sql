-- ═══════════════════════════════════════════════════════════════
-- TRAVA DE PREÇO — preço contratado válido por 12 meses
-- Ao comprar, grava o preço da época. Reajuste só após 12 meses.
-- ═══════════════════════════════════════════════════════════════

-- Adiciona colunas em aceites_plano para registrar preço contratado
ALTER TABLE public.aceites_plano
  ADD COLUMN IF NOT EXISTS preco_contratado   numeric(12,2),
  ADD COLUMN IF NOT EXISTS preco_valido_ate   timestamptz;   -- data de validade do preço (aceito_em + 12 meses)

-- View auxiliar: retorna o preço vigente para cada usuário com plano ativo
-- Se ainda dentro do período de 12 meses → usa preco_contratado
-- Caso contrário → usa preco atual do planos_config
CREATE OR REPLACE VIEW public.precos_vigentes AS
SELECT
  ap.user_id,
  ap.plano_key,
  ap.preco_contratado,
  ap.preco_valido_ate,
  pc.preco                               AS preco_atual,
  pc.nome                                AS nome_plano,
  CASE
    WHEN ap.preco_valido_ate IS NOT NULL AND ap.preco_valido_ate > now()
      THEN ap.preco_contratado           -- ainda na janela de 12 meses
    ELSE pc.preco                        -- reajuste já liberado
  END                                    AS preco_efetivo
FROM public.aceites_plano ap
JOIN public.planos_config pc ON pc.plano_key = ap.plano_key
WHERE ap.status = 'ativo'
  AND ap.plano_key IS NOT NULL;

-- RLS: usuário vê apenas seu próprio preço vigente
ALTER VIEW public.precos_vigentes OWNER TO postgres;

-- Função helper chamada no checkout para registrar preço contratado
CREATE OR REPLACE FUNCTION public.registrar_preco_contratado(
  p_user_id   uuid,
  p_plano_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_preco numeric(12,2);
BEGIN
  SELECT preco INTO v_preco FROM public.planos_config WHERE plano_key = p_plano_key;

  UPDATE public.aceites_plano
  SET preco_contratado = v_preco,
      preco_valido_ate  = now() + interval '12 months'
  WHERE user_id = p_user_id
    AND plano_key = p_plano_key
    AND status = 'ativo'
    -- só grava se ainda não tem preço contratado (primeira vez)
    AND preco_contratado IS NULL;
END;
$$;
