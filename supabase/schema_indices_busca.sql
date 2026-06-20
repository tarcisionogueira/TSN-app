-- Índices para acelerar a busca de imóveis em leilão
-- Execute no SQL Editor do Supabase

CREATE INDEX IF NOT EXISTS idx_imoveis_ativo ON public.imoveis_leilao(ativo);
CREATE INDEX IF NOT EXISTS idx_imoveis_estado ON public.imoveis_leilao(estado) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_imoveis_tipo ON public.imoveis_leilao(tipo) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_imoveis_modalidade ON public.imoveis_leilao(modalidade) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_imoveis_valor ON public.imoveis_leilao(valor_minimo) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_imoveis_desconto ON public.imoveis_leilao(desconto_percentual DESC NULLS LAST) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_imoveis_cidade ON public.imoveis_leilao(cidade) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_imoveis_pagamento ON public.imoveis_leilao(forma_pagamento) WHERE ativo = true;
