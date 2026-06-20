-- ================================================================
-- EQUIPE — Validações automáticas, triggers e funções
-- Execute APÓS schema_equipe.sql e schema_analises.sql
-- ================================================================

-- ─── 1. TRIGGER: prazo_ate automático para solicitações processuais ──────────
CREATE OR REPLACE FUNCTION public.fn_prazo_processual()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'processual' AND NEW.prazo_ate IS NULL THEN
    NEW.prazo_ate := now() + INTERVAL '24 hours';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_prazo_processual ON public.solicitacoes;
CREATE TRIGGER tg_prazo_processual
  BEFORE INSERT OR UPDATE OF tipo ON public.solicitacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_prazo_processual();

-- ─── 2. TRIGGER: updated_at em solicitacoes ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tg_solicitacoes_updated_at ON public.solicitacoes;
CREATE TRIGGER tg_solicitacoes_updated_at
  BEFORE UPDATE ON public.solicitacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ─── 3. TRIGGER: checklist completo → marca para revisão ─────────────────────
-- Quando todos os 9 itens do checklist forem true, status passa a 'concluido'
-- automaticamente (analista ainda pode reverter manualmente)
CREATE OR REPLACE FUNCTION public.fn_checklist_completo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_keys text[] := ARRAY[
    'leiloeiro_habilitado','matricula_analisada','edital_analisado',
    'processo_cnj','debitos_verificados','ocupacao_verificada',
    'avaliacao_mercado','viabilidade_financeira','laudo_emitido'
  ];
  v_key text;
  v_todos boolean := true;
BEGIN
  IF NEW.checklist IS NULL THEN RETURN NEW; END IF;
  FOREACH v_key IN ARRAY v_keys LOOP
    IF (NEW.checklist ->> v_key) IS DISTINCT FROM 'true' THEN
      v_todos := false;
      EXIT;
    END IF;
  END LOOP;
  IF v_todos AND NEW.status = 'em_andamento' THEN
    NEW.status := 'concluido';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_checklist_completo ON public.solicitacoes;
CREATE TRIGGER tg_checklist_completo
  BEFORE UPDATE OF checklist ON public.solicitacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_checklist_completo();

-- ─── 4. TRIGGER: convite_equipe marcado como usado ao aceitar ────────────────
-- Chamado quando perfis.role é atualizado via aplicação com token do convite.
-- A aplicação chama: SELECT usar_convite_equipe(token, user_id)
CREATE OR REPLACE FUNCTION public.usar_convite_equipe(p_token text, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_convite record;
  v_role text;
BEGIN
  SELECT * INTO v_convite
    FROM public.convites_equipe
    WHERE token = p_token
      AND ativo = true
      AND usado_em IS NULL
      AND (expira_em IS NULL OR expira_em > now())
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Convite inválido ou já utilizado');
  END IF;

  -- Define role principal (primeiro da lista)
  v_role := v_convite.roles[1];

  -- Atualiza perfil do usuário com o role
  UPDATE public.perfis
    SET role = v_role,
        updated_at = now()
    WHERE id = p_user_id;

  -- Marca convite como usado
  UPDATE public.convites_equipe
    SET usado_em = now(),
        usado_por = p_user_id,
        ativo = false
    WHERE id = v_convite.id;

  RETURN jsonb_build_object('ok', true, 'roles', v_convite.roles, 'role_principal', v_role);
END;
$$;

-- ─── 5. FUNÇÃO: distribuição automática round-robin ──────────────────────────
-- Distribui solicitacoes sem analista entre analistas disponíveis
-- pelo menor número de atendimentos em_andamento
CREATE OR REPLACE FUNCTION public.distribuir_solicitacoes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_analistas uuid[];
  v_solicitacao record;
  v_analista_idx integer := 0;
  v_distribuidas integer := 0;
  v_cargas integer[];
  v_min_carga integer;
  v_min_idx integer;
BEGIN
  -- Pega analistas ativos ordenados por carga atual (menor primeiro)
  SELECT array_agg(sub.id ORDER BY sub.carga ASC)
  INTO v_analistas
  FROM (
    SELECT p.id,
           COUNT(s.id) FILTER (WHERE s.status = 'em_andamento') AS carga
    FROM public.perfis p
    LEFT JOIN public.solicitacoes s ON s.analista_id = p.id AND s.status = 'em_andamento'
    WHERE p.role IN ('analista','advogado') AND p.ativo = true
    GROUP BY p.id
  ) sub;

  IF v_analistas IS NULL OR array_length(v_analistas, 1) = 0 THEN
    RETURN 0;
  END IF;

  -- Distribui cada solicitação pendente
  FOR v_solicitacao IN
    SELECT id FROM public.solicitacoes
    WHERE status = 'solicitado' AND analista_id IS NULL
    ORDER BY
      CASE tipo WHEN 'processual' THEN 0 WHEN 'edital' THEN 1 ELSE 2 END,
      created_at ASC
  LOOP
    -- Round-robin circular
    v_analista_idx := ((v_analista_idx) % array_length(v_analistas, 1)) + 1;

    UPDATE public.solicitacoes
      SET analista_id = v_analistas[v_analista_idx],
          status = 'em_andamento',
          updated_at = now()
      WHERE id = v_solicitacao.id;

    v_distribuidas := v_distribuidas + 1;
  END LOOP;

  RETURN v_distribuidas;
END;
$$;

-- ─── 6. VIEW: solicitações com dados do cliente e analista ───────────────────
CREATE OR REPLACE VIEW public.v_solicitacoes AS
SELECT
  s.id,
  s.tipo,
  s.status,
  s.prazo_ate,
  s.imovel_ref,
  s.imovel_nome,
  s.imovel_cidade,
  s.checklist,
  s.notas_analista,
  s.google_meet_link,
  s.resultado,
  s.created_at,
  s.updated_at,
  -- Cliente
  s.user_id,
  pc.nome   AS cliente_nome,
  pc.cpf    AS cliente_cpf,
  -- Analista
  s.analista_id,
  pa.nome   AS analista_nome,
  pa.role   AS analista_role,
  -- Flags calculadas
  (s.status = 'solicitado' AND s.analista_id IS NULL) AS aguardando_atribuicao,
  (s.tipo = 'processual' AND s.prazo_ate < now() AND s.status NOT IN ('concluido','cancelado')) AS prazo_vencido,
  EXTRACT(EPOCH FROM (COALESCE(s.updated_at, now()) - s.created_at))/3600 AS horas_abertura
FROM public.solicitacoes s
LEFT JOIN public.perfis pc ON pc.id = s.user_id
LEFT JOIN public.perfis pa ON pa.id = s.analista_id;

-- ─── 7. FUNÇÃO: métricas de performance por analista ─────────────────────────
CREATE OR REPLACE FUNCTION public.performance_analista(p_analista_id uuid, p_mes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mes text := COALESCE(p_mes, to_char(now(), 'YYYY-MM'));
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_mes',         COUNT(*) FILTER (WHERE to_char(created_at,'YYYY-MM') = v_mes),
    'em_andamento',      COUNT(*) FILTER (WHERE status = 'em_andamento'),
    'concluidos_mes',    COUNT(*) FILTER (WHERE status = 'concluido' AND to_char(updated_at,'YYYY-MM') = v_mes),
    'cancelados_mes',    COUNT(*) FILTER (WHERE status = 'cancelado' AND to_char(updated_at,'YYYY-MM') = v_mes),
    'processual_vencido',COUNT(*) FILTER (WHERE tipo='processual' AND prazo_ate < now() AND status NOT IN ('concluido','cancelado')),
    'tempo_medio_horas', ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) FILTER (WHERE status = 'concluido')::numeric, 1)
  )
  INTO v_result
  FROM public.solicitacoes
  WHERE analista_id = p_analista_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ─── 8. RESTRIÇÃO: roles válidos em convites_equipe ──────────────────────────
-- (Cria constraint apenas se a tabela já existir — rode depois de schema_equipe.sql)
DO $$ BEGIN
  ALTER TABLE public.convites_equipe
    ADD CONSTRAINT chk_roles_validos
    CHECK (roles <@ ARRAY['analista','advogado','consultor','admin']::text[]);
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL;
END $$;

-- ─── 9. ALERTA automático: prazo processual vencendo em 2h ──────────────────
-- View para o admin monitorar (sem precisar de cron externo por ora)
CREATE OR REPLACE VIEW public.v_alertas_prazo AS
SELECT
  s.id,
  s.imovel_nome,
  s.imovel_cidade,
  s.prazo_ate,
  pc.nome AS cliente_nome,
  pa.nome AS analista_nome,
  ROUND(EXTRACT(EPOCH FROM (s.prazo_ate - now()))/3600, 1) AS horas_restantes,
  CASE
    WHEN s.prazo_ate < now() THEN 'vencido'
    WHEN s.prazo_ate < now() + INTERVAL '2 hours' THEN 'critico'
    WHEN s.prazo_ate < now() + INTERVAL '6 hours' THEN 'atencao'
    ELSE 'ok'
  END AS nivel_alerta
FROM public.solicitacoes s
LEFT JOIN public.perfis pc ON pc.id = s.user_id
LEFT JOIN public.perfis pa ON pa.id = s.analista_id
WHERE s.tipo = 'processual'
  AND s.status NOT IN ('concluido','cancelado')
ORDER BY s.prazo_ate ASC;

-- ─── 10. Colunas adicionais em solicitacoes (se não existirem) ───────────────
ALTER TABLE public.solicitacoes
  ADD COLUMN IF NOT EXISTS checklist        jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notas_analista   text,
  ADD COLUMN IF NOT EXISTS google_meet_link text;

-- Índice para busca por analista e status
CREATE INDEX IF NOT EXISTS idx_solicitacoes_analista ON public.solicitacoes(analista_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_tipo     ON public.solicitacoes(tipo);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_prazo    ON public.solicitacoes(prazo_ate) WHERE prazo_ate IS NOT NULL;
