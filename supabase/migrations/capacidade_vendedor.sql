-- "Vender" como CAPACIDADE (não troca o papel/plano). Um cliente pagante ou membro
-- da equipe pode ganhar a capacidade de vender por cima do que já é.
--  vendedor_tipo: 'consultor' (com carteira/care) | 'afiliado' (só comissão) | null.
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS vendedor_tipo text;

-- Convite de vendedor: link que o admin envia; quem abre LOGADO ativa a capacidade
-- na própria conta (mantém plano/função). Reutilizável até expirar/desativar.
CREATE TABLE IF NOT EXISTS public.convites_vendedor (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token         text UNIQUE NOT NULL,
  tipo          text NOT NULL DEFAULT 'afiliado',
  comissao_pct  numeric(5,2) NOT NULL DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  criado_por    uuid REFERENCES auth.users(id),
  expira_em     timestamptz,
  criado_em     timestamptz DEFAULT now()
);
ALTER TABLE public.convites_vendedor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin gerencia convites_vendedor" ON public.convites_vendedor;
CREATE POLICY "admin gerencia convites_vendedor" ON public.convites_vendedor FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "publico le convite ativo" ON public.convites_vendedor;
CREATE POLICY "publico le convite ativo" ON public.convites_vendedor FOR SELECT USING (ativo = true);
