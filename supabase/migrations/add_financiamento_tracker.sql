-- Tracker de financiamento/hipoteca de imóveis arrematados
-- Execute no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS public.financiamentos (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id               uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  imovel_id             text,
  imovel_nome           text,
  -- Parâmetros do financiamento (editáveis pelo usuário)
  valor_imovel          numeric(15,2),
  valor_sinal           numeric(15,2),
  sinal_percentual      numeric(5,2),
  valor_parcela         numeric(15,2),
  num_parcelas          int,
  data_sinal            date,
  data_primeira_parcela date,
  taxa_juros_anual      numeric(6,3),
  indice_correcao       text DEFAULT 'prefixado'
    CHECK (indice_correcao IN ('SELIC','IPCA','IGPM','prefixado','TR')),
  -- Controle de notificações
  notificar_email       boolean DEFAULT true,
  notificado_sinal      boolean DEFAULT false,
  -- Metadados
  origem_preenchimento  text DEFAULT 'manual'
    CHECK (origem_preenchimento IN ('manual','ia_edital')),
  notas                 text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE public.financiamentos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='financiamentos' AND policyname='fin_proprio') THEN
    EXECUTE 'CREATE POLICY "fin_proprio" ON public.financiamentos FOR ALL USING (auth.uid() = user_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='financiamentos' AND policyname='fin_admin') THEN
    EXECUTE 'CREATE POLICY "fin_admin" ON public.financiamentos FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_financiamentos_user   ON public.financiamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_financiamentos_imovel ON public.financiamentos(imovel_id) WHERE imovel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financiamentos_datas  ON public.financiamentos(data_sinal, data_primeira_parcela) WHERE notificar_email = true;
