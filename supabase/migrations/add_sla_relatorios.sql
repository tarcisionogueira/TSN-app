-- SLA de relatórios: prazo de entrega para mercadológico (4h) e jurídico (48h)
-- Execute no SQL Editor do Supabase

-- Adiciona colunas de SLA e controle de publicação na tabela de casos
ALTER TABLE public.casos
  ADD COLUMN IF NOT EXISTS prazo_mercadologico  timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS prazo_juridico       timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mercadologico_status text        DEFAULT NULL
    CHECK (mercadologico_status IN ('pendente','em_revisao','publicado','atrasado')),
  ADD COLUMN IF NOT EXISTS juridico_status      text        DEFAULT NULL
    CHECK (juridico_status IN ('pendente','em_revisao','publicado','atrasado'));

COMMENT ON COLUMN public.casos.prazo_mercadologico IS 'Deadline: criado_em + 4h. Analista deve revisar e publicar antes disso.';
COMMENT ON COLUMN public.casos.prazo_juridico      IS 'Deadline: criado_em + 48h. Advogado deve revisar e publicar antes disso.';

-- Função para calcular prazos automaticamente ao criar um caso
CREATE OR REPLACE FUNCTION set_caso_prazos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.prazo_mercadologico IS NULL THEN
    NEW.prazo_mercadologico := NEW.created_at + INTERVAL '4 hours';
  END IF;
  IF NEW.prazo_juridico IS NULL THEN
    NEW.prazo_juridico := NEW.created_at + INTERVAL '48 hours';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_caso_prazos ON public.casos;
CREATE TRIGGER trg_set_caso_prazos
  BEFORE INSERT ON public.casos
  FOR EACH ROW EXECUTE FUNCTION set_caso_prazos();

-- View para monitorar casos com SLA em risco
CREATE OR REPLACE VIEW public.casos_sla_monitor AS
SELECT
  c.id,
  c.imovel_endereco,
  c.status_etapa,
  c.prazo_mercadologico,
  c.prazo_juridico,
  c.mercadologico_status,
  c.juridico_status,
  CASE
    WHEN c.mercadologico_status = 'publicado' THEN 'ok'
    WHEN c.prazo_mercadologico < now() THEN 'atrasado'
    WHEN c.prazo_mercadologico < now() + INTERVAL '1 hour' THEN 'critico'
    ELSE 'no_prazo'
  END AS mercadologico_sla,
  CASE
    WHEN c.juridico_status = 'publicado' THEN 'ok'
    WHEN c.prazo_juridico < now() THEN 'atrasado'
    WHEN c.prazo_juridico < now() + INTERVAL '4 hours' THEN 'critico'
    ELSE 'no_prazo'
  END AS juridico_sla,
  p_analista.id  AS analista_id,
  p_cliente.id   AS cliente_id
FROM public.casos c
LEFT JOIN public.perfis p_analista ON p_analista.id = c.analista_id
LEFT JOIN public.perfis p_cliente  ON p_cliente.id  = c.cliente_id
WHERE c.status_etapa NOT IN ('concluido','arquivado','perdido');

-- RLS: somente admin e analista veem
COMMENT ON VIEW public.casos_sla_monitor IS 'Monitor de SLA: mercadológico 4h, jurídico 48h';
