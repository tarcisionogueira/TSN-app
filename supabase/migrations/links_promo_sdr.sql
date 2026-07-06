-- Unifica LINK PROMOCIONAL + função SDR (decisão do dono).
-- O link promocional passa a poder: (a) definir o benefício (desconto já existia;
-- agora também CARÊNCIA e VALIDADE DO BENEFÍCIO, além da validade do link que já
-- existe em validade_ate) e (b) carregar PERGUNTAS de qualificação (SDR). Quando o
-- visitante do tráfego responde, vira um LEAD atribuído a um consultor (mesma
-- pipeline do SDR), e só então segue para o checkout com o desconto.
--
-- Observação: carência e validade do benefício, por ora, são REGISTRADAS e EXIBIDAS
-- (o consultor/checkout honram) — não automatizam a cobrança no Asaas ainda.
ALTER TABLE public.links_promo
  ADD COLUMN IF NOT EXISTS carencia_dias            int,   -- dias de carência (ex.: 1º mês grátis = 30)
  ADD COLUMN IF NOT EXISTS beneficio_validade_dias  int,   -- por quanto tempo o benefício vale (ex.: 90)
  ADD COLUMN IF NOT EXISTS perguntas                jsonb DEFAULT '[]'::jsonb; -- [{id,texto,tipo,opcoes}]

-- Lead de PROMOÇÃO reaproveita sdr_leads (que já roteia para o consultor).
-- produto_id fica NULL (não é produto SDR); o vínculo é pelo promo_id.
ALTER TABLE public.sdr_leads
  ADD COLUMN IF NOT EXISTS promo_id uuid REFERENCES public.links_promo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sdr_leads_promo ON public.sdr_leads(promo_id) WHERE promo_id IS NOT NULL;
