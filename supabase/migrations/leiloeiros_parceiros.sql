CREATE TABLE IF NOT EXISTS public.leiloeiros_parceiros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  nome        varchar(200) NOT NULL,
  nome_fantasia varchar(200),
  cnpj        varchar(14),
  cpf         varchar(11),
  email       varchar(200) NOT NULL,
  telefone    varchar(30),
  cep         varchar(8),
  logradouro  varchar(200),
  numero      varchar(20),
  complemento varchar(100),
  bairro      varchar(100),
  municipio   varchar(100),
  uf          varchar(2),
  status      varchar(20) NOT NULL DEFAULT 'pendente',
  criado_em   timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

ALTER TABLE public.leiloeiros_parceiros ENABLE ROW LEVEL SECURITY;

-- Apenas service role acessa (leiloeiros não têm login no sistema)
CREATE POLICY "service_only" ON public.leiloeiros_parceiros
  FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_leiloeiros_token ON public.leiloeiros_parceiros(token);
CREATE INDEX IF NOT EXISTS idx_leiloeiros_status ON public.leiloeiros_parceiros(status);
