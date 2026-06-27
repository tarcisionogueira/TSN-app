-- ════════════════════════════════════════════════════════════════════════════
-- BASE para Saque + Distribuição de Honorários (rodar no SQL Editor do Supabase)
-- Parte 1 (aditiva, segura). A lógica de sorteio/crédito vem na parte 2.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Percentuais do honorário de êxito (10% do valor de arrematação)
--    admin 4,5% · analista 0,5% · advogado 5%
INSERT INTO public.config_honorarios (id, total_pct, admin_pct, advogado_pct, analista_pct)
VALUES (1, 10.0, 4.5, 5.0, 0.5)
ON CONFLICT (id) DO UPDATE
  SET total_pct = 10.0, admin_pct = 4.5, advogado_pct = 5.0, analista_pct = 0.5;

-- 2) Chave PIX no perfil (para receber saques)
ALTER TABLE public.perfis ADD COLUMN IF NOT EXISTS chave_pix text;

-- 3) Garante colunas de sorteio no caso (se ainda não existirem)
ALTER TABLE public.casos ADD COLUMN IF NOT EXISTS analista_id uuid;
ALTER TABLE public.casos ADD COLUMN IF NOT EXISTS advogado_id uuid;

-- 3b) Colunas em arrematacoes: equipe sorteada + controle do honorário (idempotência)
ALTER TABLE public.arrematacoes ADD COLUMN IF NOT EXISTS analista_id uuid;
ALTER TABLE public.arrematacoes ADD COLUMN IF NOT EXISTS advogado_id uuid;
ALTER TABLE public.arrematacoes ADD COLUMN IF NOT EXISTS honorarios_valor   numeric(12,2);
ALTER TABLE public.arrematacoes ADD COLUMN IF NOT EXISTS honorarios_status  text DEFAULT 'pendente'; -- pendente | distribuido | cancelado

-- 4) Razão de saldo (ledger): toda comissão/honorário/saque é um lançamento.
--    saldo do usuário = SUM(valor) WHERE status='disponivel'  (créditos +, saques -)
CREATE TABLE IF NOT EXISTS public.saldo_lancamentos (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.perfis(id),
  tipo         text NOT NULL,          -- 'comissao_venda' | 'honorario_exito' | 'saque'
  valor        numeric(12,2) NOT NULL, -- crédito > 0, saque < 0
  origem_tipo  text,                   -- 'arrematacao' | 'venda_produto' | ...
  origem_id    text,                   -- id da arrematação/venda
  descricao    text,
  -- Crédito: 'disponivel'. Saque: 'solicitado' (reservado) -> 'sacado' (pago). 'cancelado' = ignora.
  status       text NOT NULL DEFAULT 'disponivel',
  criado_em    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saldo_user ON public.saldo_lancamentos (user_id, status);

ALTER TABLE public.saldo_lancamentos ENABLE ROW LEVEL SECURITY;
-- Cada usuário vê só os próprios lançamentos; admin vê todos.
CREATE POLICY saldo_self ON public.saldo_lancamentos FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role = 'admin'));

-- View de saldo consolidado por usuário (prestação de contas)
CREATE OR REPLACE VIEW public.saldo_usuarios AS
SELECT p.id AS user_id, p.nome, p.role, p.chave_pix,
       -- Saldo = créditos − saques (solicitados reservam; cancelados ignorados)
       COALESCE(SUM(sl.valor) FILTER (WHERE sl.status <> 'cancelado'), 0) AS saldo_disponivel,
       COALESCE(-SUM(sl.valor) FILTER (WHERE sl.status = 'sacado'), 0)    AS total_sacado,
       COALESCE(-SUM(sl.valor) FILTER (WHERE sl.status = 'solicitado'), 0) AS saque_pendente
FROM public.perfis p
LEFT JOIN public.saldo_lancamentos sl ON sl.user_id = p.id
WHERE p.role IN ('admin','analista','advogado','consultor')
GROUP BY p.id, p.nome, p.role, p.chave_pix;
ALTER VIEW public.saldo_usuarios SET (security_invoker = on);
