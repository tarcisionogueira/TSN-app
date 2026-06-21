-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA: Fluxo de Análise e Arrematação TSN
-- Ordem: cotas → casos → analise_jobs → analise_relatorios →
--        reunioes → analise_juridica → arrematacoes → procuracoes
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. COTAS DE ANÁLISE (controle mensal por cliente) ──────────────────
CREATE TABLE IF NOT EXISTS public.cotas_analise (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  usuario_id            uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  mes_ref               date NOT NULL,           -- primeiro dia do mês (ex: 2026-06-01)
  analises_usadas       int  NOT NULL DEFAULT 0,
  analises_limite       int  NOT NULL DEFAULT 3,  -- definido pelo plano no momento da criação
  reunioes_usadas       int  NOT NULL DEFAULT 0,
  reunioes_limite       int  NOT NULL DEFAULT 0,
  extras_analista       int  NOT NULL DEFAULT 0,  -- análises extras concedidas pelo analista (máx 2)
  created_at            timestamptz DEFAULT now(),
  UNIQUE (usuario_id, mes_ref)
);

ALTER TABLE public.cotas_analise ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cotas_analise' AND policyname='cotas_proprio') THEN
    EXECUTE 'CREATE POLICY "cotas_proprio" ON public.cotas_analise FOR SELECT USING (auth.uid() = usuario_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cotas_analise' AND policyname='cotas_admin_all') THEN
    EXECUTE 'CREATE POLICY "cotas_admin_all" ON public.cotas_analise FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cotas_usuario_mes ON public.cotas_analise(usuario_id, mes_ref);


-- ── 2. CASOS (entidade central que une todas as etapas) ────────────────
-- status_etapa reflete em qual etapa do fluxo o caso se encontra
CREATE TABLE IF NOT EXISTS public.casos (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  cliente_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  analista_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  advogado_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Imóvel referenciado
  imovel_id             text,                    -- FK lógica para imoveis_leilao.id
  imovel_endereco       text,                    -- desnormalizado para exibição rápida
  imovel_valor          numeric(15,2),

  -- Etapa atual do fluxo
  status_etapa          text NOT NULL DEFAULT 'analise_solicitada'
    CHECK (status_etapa IN (
      'analise_solicitada',   -- cliente solicitou análises
      'analises_prontas',     -- relatórios liberados, aguarda reunião
      'reuniao_agendada',     -- 1ª reunião marcada
      'reuniao_realizada',    -- analista marcou como realizada
      'juridico_solicitado',  -- encaminhado ao advogado
      'juridico_concluido',   -- advogado entregou parecer
      'segunda_reuniao',      -- 2ª reunião agendada/realizada
      'arrematado',           -- cliente sinalizou arrematação
      'honorarios_pagos',     -- 10% confirmados
      'procuracao_assinada',  -- procuração assinada pelo cliente
      'pos_arrematacao'       -- acompanhamento em andamento
    )),

  -- Acesso ao jurídico aprofundado
  juridico_liberado     boolean NOT NULL DEFAULT false,  -- liberado por plano ou contratação assessoria

  -- Controle de tipo de leilão (para arrematação)
  tipo_leilao           text CHECK (tipo_leilao IN ('judicial','extrajudicial')),

  -- Timestamps das transições de etapa
  iniciado_em           timestamptz DEFAULT now(),
  juridico_enviado_em   timestamptz,
  arrematado_em         timestamptz,
  concluido_em          timestamptz,

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE public.casos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='casos' AND policyname='casos_cliente') THEN
    EXECUTE 'CREATE POLICY "casos_cliente" ON public.casos FOR SELECT USING (auth.uid() = cliente_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='casos' AND policyname='casos_analista') THEN
    EXECUTE 'CREATE POLICY "casos_analista" ON public.casos FOR SELECT USING (auth.uid() = analista_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='casos' AND policyname='casos_advogado') THEN
    EXECUTE 'CREATE POLICY "casos_advogado" ON public.casos FOR SELECT USING (auth.uid() = advogado_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='casos' AND policyname='casos_admin_all') THEN
    EXECUTE 'CREATE POLICY "casos_admin_all" ON public.casos FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_casos_cliente   ON public.casos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_casos_analista  ON public.casos(analista_id);
CREATE INDEX IF NOT EXISTS idx_casos_advogado  ON public.casos(advogado_id);
CREATE INDEX IF NOT EXISTS idx_casos_imovel    ON public.casos(imovel_id);
CREATE INDEX IF NOT EXISTS idx_casos_status    ON public.casos(status_etapa);


-- ── 3. ANALISE_JOBS (fila de análise com retry e prazo 48h) ───────────
CREATE TABLE IF NOT EXISTS public.analise_jobs (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  caso_id               uuid REFERENCES public.casos(id) ON DELETE CASCADE NOT NULL,
  tipo                  text NOT NULL
    CHECK (tipo IN ('mercadologica','financeira','fluxo_caixa','juridica_preliminar')),

  status                text NOT NULL DEFAULT 'aguardando'
    CHECK (status IN ('aguardando','processando','concluido','falha_parcial','falha')),

  tentativas            int  NOT NULL DEFAULT 0,
  max_tentativas        int  NOT NULL DEFAULT 3,
  proxima_tentativa_em  timestamptz,             -- quando retentar após falha
  prazo_limite_em       timestamptz,             -- agora + 48h (definido ao criar)

  -- Dados de entrada usados pela IA
  input_json            jsonb,                   -- endereço, nº processo, URL edital, etc.

  -- Resultado
  resultado_json        jsonb,                   -- dados coletados pelas APIs
  erro_msg              text,

  iniciado_em           timestamptz,
  concluido_em          timestamptz,
  created_at            timestamptz DEFAULT now(),

  UNIQUE (caso_id, tipo)
);

ALTER TABLE public.analise_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='analise_jobs' AND policyname='jobs_admin_all') THEN
    EXECUTE 'CREATE POLICY "jobs_admin_all" ON public.analise_jobs FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_caso   ON public.analise_jobs(caso_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.analise_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_prazo  ON public.analise_jobs(prazo_limite_em) WHERE status NOT IN ('concluido','falha');


-- ── 4. ANALISE_RELATORIOS (conteúdo gerado pela IA por tipo) ──────────
CREATE TABLE IF NOT EXISTS public.analise_relatorios (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  caso_id               uuid REFERENCES public.casos(id) ON DELETE CASCADE NOT NULL,
  tipo                  text NOT NULL
    CHECK (tipo IN ('mercadologica','financeira','fluxo_caixa','juridica_preliminar')),

  versao                int  NOT NULL DEFAULT 1,  -- permite regeração
  conteudo_md           text,                     -- relatório em markdown (renderizado no front)
  conteudo_json         jsonb,                    -- dados estruturados para o PDF
  gerado_por_modelo     text,                     -- ex: 'claude-sonnet-4-6'
  incompleto            boolean DEFAULT false,    -- true se a IA não conseguiu todos os dados
  secoes_faltando       text[],                   -- lista de seções que falharam

  notificado_cliente    boolean DEFAULT false,
  notificado_em         timestamptz,

  created_at            timestamptz DEFAULT now(),

  UNIQUE (caso_id, tipo, versao)
);

ALTER TABLE public.analise_relatorios ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='analise_relatorios' AND policyname='relatorios_cliente') THEN
    EXECUTE 'CREATE POLICY "relatorios_cliente" ON public.analise_relatorios FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.casos WHERE id = caso_id AND cliente_id = auth.uid()))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='analise_relatorios' AND policyname='relatorios_equipe') THEN
    EXECUTE 'CREATE POLICY "relatorios_equipe" ON public.analise_relatorios FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.casos WHERE id = caso_id AND (analista_id = auth.uid() OR advogado_id = auth.uid())))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='analise_relatorios' AND policyname='relatorios_admin') THEN
    EXECUTE 'CREATE POLICY "relatorios_admin" ON public.analise_relatorios FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_relatorios_caso ON public.analise_relatorios(caso_id);


-- ── 5. REUNIOES (agendamentos 1ª e 2ª reunião) ────────────────────────
CREATE TABLE IF NOT EXISTS public.reunioes (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  caso_id               uuid REFERENCES public.casos(id) ON DELETE CASCADE NOT NULL,
  numero                int  NOT NULL CHECK (numero IN (1, 2)),  -- 1ª ou 2ª reunião
  analista_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cliente_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  status                text NOT NULL DEFAULT 'agendada'
    CHECK (status IN ('agendada','realizada','cancelada')),

  data_hora             timestamptz NOT NULL,
  link_videochamada     text,                    -- link da plataforma com transcrição
  transcricao_url       text,                    -- link para a transcrição após a reunião
  observacoes           text,                    -- anotações do analista pós-reunião

  agendado_em           timestamptz DEFAULT now(),
  realizado_em          timestamptz,             -- analista marca quando concluir

  created_at            timestamptz DEFAULT now()
);

ALTER TABLE public.reunioes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reunioes' AND policyname='reunioes_participantes') THEN
    EXECUTE 'CREATE POLICY "reunioes_participantes" ON public.reunioes FOR SELECT
      USING (auth.uid() = analista_id OR auth.uid() = cliente_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reunioes' AND policyname='reunioes_admin') THEN
    EXECUTE 'CREATE POLICY "reunioes_admin" ON public.reunioes FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reunioes_caso     ON public.reunioes(caso_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_analista ON public.reunioes(analista_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_cliente  ON public.reunioes(cliente_id);


-- ── 6. ANALISE_JURIDICA (checklist do advogado + parecer final) ────────
-- Espelha o Checklist de Análise Processual (Google Drive)
CREATE TABLE IF NOT EXISTS public.analise_juridica (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  caso_id               uuid REFERENCES public.casos(id) ON DELETE CASCADE NOT NULL,
  advogado_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  prazo_ate             timestamptz NOT NULL,    -- recebido_em + 10 dias
  entregue_em           timestamptz,

  -- 1. Identificação Básica (pré-preenchido pela IA onde possível)
  num_processo          text,
  vara_tribunal         text,
  partes_exequente      text,
  partes_executado      text,
  num_matricula         text,
  num_edital            text,

  -- 2. Análise do Edital (pré-preenchido pela IA)
  forma_pagamento       text,                    -- 'a_vista' | 'parcelado' | null
  comissao_leiloeiro    text,
  estado_ocupacao       text,                    -- 'ocupado' | 'desocupado' | null
  venda_ad_corpus       boolean,
  debitos_responsavel   text,                    -- 'arrematante' | 'sub-rogado' | null
  debitos_obs           text,

  -- 3. Análise da Matrícula (pré-preenchido pela IA)
  titularidade_ok       boolean,
  titularidade_obs      text,
  penhoras_concorrentes boolean,
  penhoras_obs          text,
  hipoteca_fiduciaria   boolean,
  hipoteca_obs          text,
  gravames_serios       boolean,
  gravames_obs          text,
  descricao_imovel_ok   boolean,
  descricao_obs         text,

  -- 4. Análise Processual (pré-preenchido via CNJ pela IA)
  citacao_valida        boolean,
  citacao_obs           text,
  intimacao_executado   boolean,
  intimacao_conjuge     boolean,
  conjuge_obs           text,
  recursos_pendentes    boolean,
  recursos_obs          text,
  efeito_suspensivo     boolean,
  efeito_obs            text,
  avaliacao_atualizada  boolean,
  avaliacao_obs         text,
  preco_minimo_ok       boolean,
  preco_minimo_obs      text,

  -- 5. Análise de Custos (preenchido pelo advogado)
  debitos_iptu_valor    numeric(15,2),
  debitos_cond_valor    numeric(15,2),
  hierarquia_ok         boolean,
  hierarquia_obs        text,
  custo_desocupacao_est text,

  -- 6. Parecer Final (preenchido pelo advogado)
  red_flags             text,
  nivel_risco           text CHECK (nivel_risco IN ('baixo','medio','alto')),
  acoes_pos_arremate    text,
  resultado             text CHECK (resultado IN ('recomendo','recomendo_ressalvas','nao_recomendo')),
  ressalvas             text,

  -- Relatório final formatado
  relatorio_md          text,                   -- gerado pelo sistema ao salvar o parecer

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),

  UNIQUE (caso_id)
);

ALTER TABLE public.analise_juridica ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='analise_juridica' AND policyname='juridica_advogado') THEN
    EXECUTE 'CREATE POLICY "juridica_advogado" ON public.analise_juridica FOR ALL USING (auth.uid() = advogado_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='analise_juridica' AND policyname='juridica_analista') THEN
    EXECUTE 'CREATE POLICY "juridica_analista" ON public.analise_juridica FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.casos WHERE id = caso_id AND analista_id = auth.uid()))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='analise_juridica' AND policyname='juridica_cliente') THEN
    EXECUTE 'CREATE POLICY "juridica_cliente" ON public.analise_juridica FOR SELECT
      USING (
        entregue_em IS NOT NULL AND
        EXISTS (SELECT 1 FROM public.casos WHERE id = caso_id AND cliente_id = auth.uid())
      )';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='analise_juridica' AND policyname='juridica_admin') THEN
    EXECUTE 'CREATE POLICY "juridica_admin" ON public.analise_juridica FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_juridica_caso     ON public.analise_juridica(caso_id);
CREATE INDEX IF NOT EXISTS idx_juridica_advogado ON public.analise_juridica(advogado_id);
CREATE INDEX IF NOT EXISTS idx_juridica_prazo    ON public.analise_juridica(prazo_ate) WHERE entregue_em IS NULL;


-- ── 7. ARREMATACOES ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.arrematacoes (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  caso_id               uuid REFERENCES public.casos(id) ON DELETE CASCADE NOT NULL,
  cliente_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  tipo_leilao           text NOT NULL CHECK (tipo_leilao IN ('judicial','extrajudicial')),
  valor_arrematado      numeric(15,2) NOT NULL,
  valor_extraido_ia     boolean DEFAULT true,    -- false se o cliente digitou manualmente
  documento_url         text,                    -- auto de arrematação ou boleto (Supabase Storage)
  documento_tipo        text,                    -- 'auto_arrematacao' | 'boleto'

  -- Honorários
  honorarios_valor      numeric(15,2),           -- 10% de valor_arrematado
  honorarios_pagamento_id text,                  -- ID Asaas/Pagarme da cobrança
  honorarios_status     text DEFAULT 'pendente'
    CHECK (honorarios_status IN ('pendente','aguardando_pagamento','pago','cancelado')),
  honorarios_pago_em    timestamptz,

  -- Procuração em nome de terceiro
  em_nome_proprio       boolean DEFAULT true,
  beneficiario_nome     text,
  beneficiario_cpf      text,
  beneficiario_qualif   text,
  beneficiario_endereco text,

  sinalizado_em         timestamptz DEFAULT now(),
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE public.arrematacoes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arrematacoes' AND policyname='arrematacoes_cliente') THEN
    EXECUTE 'CREATE POLICY "arrematacoes_cliente" ON public.arrematacoes FOR SELECT USING (auth.uid() = cliente_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arrematacoes' AND policyname='arrematacoes_equipe') THEN
    EXECUTE 'CREATE POLICY "arrematacoes_equipe" ON public.arrematacoes FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.casos WHERE id = caso_id AND (analista_id = auth.uid() OR advogado_id = auth.uid())))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='arrematacoes' AND policyname='arrematacoes_admin') THEN
    EXECUTE 'CREATE POLICY "arrematacoes_admin" ON public.arrematacoes FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_arrematacoes_caso    ON public.arrematacoes(caso_id);
CREATE INDEX IF NOT EXISTS idx_arrematacoes_cliente ON public.arrematacoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_arrematacoes_honor   ON public.arrematacoes(honorarios_status);


-- ── 8. PROCURACOES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.procuracoes (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  caso_id               uuid REFERENCES public.casos(id) ON DELETE CASCADE NOT NULL,
  arrematacao_id        uuid REFERENCES public.arrematacoes(id) ON DELETE CASCADE,
  cliente_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  advogado_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Dados utilizados na geração
  dados_outorgante      jsonb NOT NULL,          -- dados do cliente (ou terceiro)
  dados_outorgado       jsonb NOT NULL,          -- dados do advogado
  dados_imovel          jsonb NOT NULL,          -- endereço, matrícula, valor

  -- Conteúdo
  conteudo_md           text NOT NULL,           -- texto da procuração gerado pela IA
  versao                int  NOT NULL DEFAULT 1,

  -- Assinatura (aceite no sistema)
  assinado              boolean DEFAULT false,
  assinado_em           timestamptz,
  ip_assinatura         text,

  -- Notificações
  advogado_notificado   boolean DEFAULT false,
  admin_notificado      boolean DEFAULT false,

  created_at            timestamptz DEFAULT now(),

  UNIQUE (caso_id, versao)
);

ALTER TABLE public.procuracoes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='procuracoes' AND policyname='procuracoes_cliente') THEN
    EXECUTE 'CREATE POLICY "procuracoes_cliente" ON public.procuracoes FOR SELECT USING (auth.uid() = cliente_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='procuracoes' AND policyname='procuracoes_advogado') THEN
    EXECUTE 'CREATE POLICY "procuracoes_advogado" ON public.procuracoes FOR SELECT
      USING (auth.uid() = advogado_id AND assinado = true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='procuracoes' AND policyname='procuracoes_admin') THEN
    EXECUTE 'CREATE POLICY "procuracoes_admin" ON public.procuracoes FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_procuracoes_caso     ON public.procuracoes(caso_id);
CREATE INDEX IF NOT EXISTS idx_procuracoes_cliente  ON public.procuracoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_procuracoes_advogado ON public.procuracoes(advogado_id);


-- ── FUNÇÃO AUXILIAR: retorna cota atual do cliente ────────────────────
-- Cria linha de cota se não existir para o mês corrente
CREATE OR REPLACE FUNCTION public.obter_cota_analise(p_user_id uuid, p_plano text)
RETURNS TABLE (
  analises_disponiveis int,
  reunioes_disponiveis int,
  analises_usadas      int,
  reunioes_usadas      int,
  extras_analista      int
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_limite_analises int;
  v_limite_reunioes int;
  v_mes             date := date_trunc('month', now())::date;
BEGIN
  -- Define limites por plano
  v_limite_analises := CASE p_plano
    WHEN 'explorador' THEN 3
    WHEN 'top2'       THEN 10
    WHEN 'assessorado'THEN 15
    WHEN 'clube'      THEN 20
    ELSE 3
  END;
  v_limite_reunioes := CASE p_plano
    WHEN 'explorador' THEN 0
    WHEN 'top2'       THEN 1
    WHEN 'assessorado'THEN 2
    WHEN 'clube'      THEN 4
    ELSE 0
  END;

  -- Garante linha para o mês
  INSERT INTO public.cotas_analise (usuario_id, mes_ref, analises_limite, reunioes_limite)
  VALUES (p_user_id, v_mes, v_limite_analises, v_limite_reunioes)
  ON CONFLICT (usuario_id, mes_ref) DO NOTHING;

  RETURN QUERY
    SELECT
      GREATEST(0, (c.analises_limite + c.extras_analista) - c.analises_usadas),
      GREATEST(0, c.reunioes_limite - c.reunioes_usadas),
      c.analises_usadas,
      c.reunioes_usadas,
      c.extras_analista
    FROM public.cotas_analise c
    WHERE c.usuario_id = p_user_id AND c.mes_ref = v_mes;
END;
$$;

-- ── FUNÇÃO: analista concede análises extras (máx 2 por cliente/mês) ──
CREATE OR REPLACE FUNCTION public.conceder_extras_analise(
  p_analista_id uuid,
  p_cliente_id  uuid,
  p_qtd         int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_mes    date := date_trunc('month', now())::date;
  v_extras int;
  v_role   text;
BEGIN
  -- Valida que quem chama é analista ou admin
  SELECT role INTO v_role FROM public.perfis WHERE id = p_analista_id;
  IF v_role NOT IN ('analista','admin') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão');
  END IF;

  -- Verifica extras já concedidos
  SELECT extras_analista INTO v_extras
  FROM public.cotas_analise
  WHERE usuario_id = p_cliente_id AND mes_ref = v_mes;

  IF v_extras IS NULL THEN v_extras := 0; END IF;

  IF (v_extras + p_qtd) > 2 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Limite de 2 análises extras por mês atingido');
  END IF;

  INSERT INTO public.cotas_analise (usuario_id, mes_ref, extras_analista)
  VALUES (p_cliente_id, v_mes, p_qtd)
  ON CONFLICT (usuario_id, mes_ref)
  DO UPDATE SET extras_analista = cotas_analise.extras_analista + p_qtd;

  RETURN jsonb_build_object('ok', true, 'extras_total', v_extras + p_qtd);
END;
$$;
