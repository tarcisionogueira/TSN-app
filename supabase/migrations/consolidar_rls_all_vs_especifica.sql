BEGIN;


-- alertas_email
DROP POLICY IF EXISTS "ae_proprios" ON public.alertas_email;

DROP POLICY IF EXISTS "ae_equipe" ON public.alertas_email;

CREATE POLICY "alertas_email_select_consolidada" ON public.alertas_email
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  );

CREATE POLICY "alertas_email_insert_consolidada" ON public.alertas_email
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "alertas_email_update_consolidada" ON public.alertas_email
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  )
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "alertas_email_delete_consolidada" ON public.alertas_email
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

-- analise_jobs
DROP POLICY IF EXISTS "jobs_admin_all" ON public.analise_jobs;

DROP POLICY IF EXISTS "analise_jobs_participante_select" ON public.analise_jobs;

DROP POLICY IF EXISTS "analise_jobs_participante_insert" ON public.analise_jobs;

CREATE POLICY "analise_jobs_select_consolidada" ON public.analise_jobs
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR ((EXISTS ( SELECT 1
   FROM casos c
  WHERE ((c.id = analise_jobs.caso_id) AND ((c.cliente_id = ( SELECT auth.uid() AS uid)) OR (c.analista_id = ( SELECT auth.uid() AS uid)) OR (c.advogado_id = ( SELECT auth.uid() AS uid)))))))
  );

CREATE POLICY "analise_jobs_insert_consolidada" ON public.analise_jobs
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (is_admin())
  OR ((EXISTS ( SELECT 1
   FROM casos c
  WHERE ((c.id = analise_jobs.caso_id) AND ((c.cliente_id = ( SELECT auth.uid() AS uid)) OR (c.analista_id = ( SELECT auth.uid() AS uid)) OR (c.advogado_id = ( SELECT auth.uid() AS uid)))))))
  );

CREATE POLICY "analise_jobs_update_consolidada" ON public.analise_jobs
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  is_admin()
  )
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "analise_jobs_delete_consolidada" ON public.analise_jobs
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- analise_juridica
DROP POLICY IF EXISTS "analise_juridica_all_consolidada" ON public.analise_juridica;

DROP POLICY IF EXISTS "analise_juridica_select_consolidada" ON public.analise_juridica;

DROP POLICY IF EXISTS "juridica_analista_insert" ON public.analise_juridica;

CREATE POLICY "analise_juridica_select_consolidada" ON public.analise_juridica
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((is_admin() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id)))
  OR (((EXISTS ( SELECT 1
   FROM casos
  WHERE ((casos.id = analise_juridica.caso_id) AND (casos.analista_id = ( SELECT auth.uid() AS uid))))) OR ((entregue_em IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM casos
  WHERE ((casos.id = analise_juridica.caso_id) AND (casos.cliente_id = ( SELECT auth.uid() AS uid))))))))
  );

CREATE POLICY "analise_juridica_insert_consolidada" ON public.analise_juridica
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  ((is_admin() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id)))
  OR ((EXISTS ( SELECT 1
   FROM casos c
  WHERE ((c.id = analise_juridica.caso_id) AND (c.analista_id = ( SELECT auth.uid() AS uid))))))
  );

CREATE POLICY "analise_juridica_update_consolidada" ON public.analise_juridica
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_admin() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id))
  )
  WITH CHECK (
  (is_admin() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id))
  );

CREATE POLICY "analise_juridica_delete_consolidada" ON public.analise_juridica
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (is_admin() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id))
  );

-- analise_relatorios
DROP POLICY IF EXISTS "relatorios_admin" ON public.analise_relatorios;

DROP POLICY IF EXISTS "analise_relatorios_select_consolidada" ON public.analise_relatorios;

CREATE POLICY "analise_relatorios_select_consolidada" ON public.analise_relatorios
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR (((EXISTS ( SELECT 1
   FROM casos
  WHERE ((casos.id = analise_relatorios.caso_id) AND (casos.cliente_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM casos
  WHERE ((casos.id = analise_relatorios.caso_id) AND ((casos.analista_id = ( SELECT auth.uid() AS uid)) OR (casos.advogado_id = ( SELECT auth.uid() AS uid))))))))
  );

CREATE POLICY "analise_relatorios_insert_consolidada" ON public.analise_relatorios
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "analise_relatorios_update_consolidada" ON public.analise_relatorios
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  is_admin()
  )
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "analise_relatorios_delete_consolidada" ON public.analise_relatorios
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- arrematado_lancamentos
DROP POLICY IF EXISTS "arr_lanc_owner_all" ON public.arrematado_lancamentos;

DROP POLICY IF EXISTS "arr_lanc_select_staff" ON public.arrematado_lancamentos;

CREATE POLICY "arrematado_lancamentos_select_consolidada" ON public.arrematado_lancamentos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['admin'::text, 'analista'::text, 'consultor'::text, 'advogado'::text]))))))
  );

CREATE POLICY "arrematado_lancamentos_insert_consolidada" ON public.arrematado_lancamentos
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "arrematado_lancamentos_update_consolidada" ON public.arrematado_lancamentos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  )
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "arrematado_lancamentos_delete_consolidada" ON public.arrematado_lancamentos
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

-- arrematados
DROP POLICY IF EXISTS "arrematados_owner_all" ON public.arrematados;

DROP POLICY IF EXISTS "arrematados_select_staff" ON public.arrematados;

CREATE POLICY "arrematados_select_consolidada" ON public.arrematados
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['admin'::text, 'analista'::text, 'consultor'::text, 'advogado'::text]))))))
  );

CREATE POLICY "arrematados_insert_consolidada" ON public.arrematados
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "arrematados_update_consolidada" ON public.arrematados
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  )
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "arrematados_delete_consolidada" ON public.arrematados
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

-- aulas_admin
DROP POLICY IF EXISTS "Admin gerencia aulas" ON public.aulas_admin;

DROP POLICY IF EXISTS "Leitura publica aulas" ON public.aulas_admin;

CREATE POLICY "aulas_admin_select_consolidada" ON public.aulas_admin
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  OR (true)
  );

CREATE POLICY "aulas_admin_insert_consolidada" ON public.aulas_admin
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "aulas_admin_update_consolidada" ON public.aulas_admin
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "aulas_admin_delete_consolidada" ON public.aulas_admin
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

-- casos
DROP POLICY IF EXISTS "casos_admin_all" ON public.casos;

DROP POLICY IF EXISTS "casos_select_consolidada" ON public.casos;

DROP POLICY IF EXISTS "casos_cliente_insert" ON public.casos;

DROP POLICY IF EXISTS "casos_participante_update" ON public.casos;

CREATE POLICY "casos_select_consolidada" ON public.casos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id) OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = analista_id) OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id)))
  );

CREATE POLICY "casos_insert_consolidada" ON public.casos
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id))
  );

CREATE POLICY "casos_update_consolidada" ON public.casos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_admin())
  OR (((cliente_id = ( SELECT auth.uid() AS uid)) OR (analista_id = ( SELECT auth.uid() AS uid)) OR (advogado_id = ( SELECT auth.uid() AS uid))))
  )
  WITH CHECK (
  (is_admin())
  OR (((cliente_id = ( SELECT auth.uid() AS uid)) OR (analista_id = ( SELECT auth.uid() AS uid)) OR (advogado_id = ( SELECT auth.uid() AS uid))))
  );

CREATE POLICY "casos_delete_consolidada" ON public.casos
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- chamados
DROP POLICY IF EXISTS "chamados_all_consolidada" ON public.chamados;

DROP POLICY IF EXISTS "chamados_consultor_comercial_sel" ON public.chamados;

DROP POLICY IF EXISTS "chamados_consultor_comercial_upd" ON public.chamados;

CREATE POLICY "chamados_select_consolidada" ON public.chamados
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id) OR ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text]))))))
  OR (((lead_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM sdr_leads l
  WHERE ((l.id = chamados.lead_id) AND (l.consultor_id = ( SELECT auth.uid() AS uid)))))))
  );

CREATE POLICY "chamados_insert_consolidada" ON public.chamados
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id) OR ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text])))))
  );

CREATE POLICY "chamados_update_consolidada" ON public.chamados
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id) OR ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text]))))))
  OR (((lead_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM sdr_leads l
  WHERE ((l.id = chamados.lead_id) AND (l.consultor_id = ( SELECT auth.uid() AS uid)))))))
  )
  WITH CHECK (
  (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id) OR ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text]))))))
  OR (((lead_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM sdr_leads l
  WHERE ((l.id = chamados.lead_id) AND (l.consultor_id = ( SELECT auth.uid() AS uid)))))))
  );

CREATE POLICY "chamados_delete_consolidada" ON public.chamados
  AS PERMISSIVE FOR DELETE TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id) OR ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text])))))
  );

-- chamados_mensagens
DROP POLICY IF EXISTS "chamados_mensagens_all_consolidada" ON public.chamados_mensagens;

DROP POLICY IF EXISTS "mensagens_consultor_comercial_sel" ON public.chamados_mensagens;

DROP POLICY IF EXISTS "mensagens_consultor_comercial_ins" ON public.chamados_mensagens;

CREATE POLICY "chamados_mensagens_select_consolidada" ON public.chamados_mensagens
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (((EXISTS ( SELECT 1
   FROM chamados
  WHERE ((chamados.id = chamados_mensagens.chamado_id) AND (chamados.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM chamados c
  WHERE ((c.id = chamados_mensagens.chamado_id) AND ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text])))))))))
  OR ((EXISTS ( SELECT 1
   FROM (chamados c
     JOIN sdr_leads l ON ((l.id = c.lead_id)))
  WHERE ((c.id = chamados_mensagens.chamado_id) AND (l.consultor_id = ( SELECT auth.uid() AS uid))))))
  );

CREATE POLICY "chamados_mensagens_insert_consolidada" ON public.chamados_mensagens
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (((EXISTS ( SELECT 1
   FROM chamados
  WHERE ((chamados.id = chamados_mensagens.chamado_id) AND (chamados.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM chamados c
  WHERE ((c.id = chamados_mensagens.chamado_id) AND ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text])))))))))
  OR ((EXISTS ( SELECT 1
   FROM (chamados c
     JOIN sdr_leads l ON ((l.id = c.lead_id)))
  WHERE ((c.id = chamados_mensagens.chamado_id) AND (l.consultor_id = ( SELECT auth.uid() AS uid))))))
  );

CREATE POLICY "chamados_mensagens_update_consolidada" ON public.chamados_mensagens
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM chamados
  WHERE ((chamados.id = chamados_mensagens.chamado_id) AND (chamados.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM chamados c
  WHERE ((c.id = chamados_mensagens.chamado_id) AND ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text]))))))))
  )
  WITH CHECK (
  ((EXISTS ( SELECT 1
   FROM chamados
  WHERE ((chamados.id = chamados_mensagens.chamado_id) AND (chamados.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM chamados c
  WHERE ((c.id = chamados_mensagens.chamado_id) AND ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text]))))))))
  );

CREATE POLICY "chamados_mensagens_delete_consolidada" ON public.chamados_mensagens
  AS PERMISSIVE FOR DELETE TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM chamados
  WHERE ((chamados.id = chamados_mensagens.chamado_id) AND (chamados.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM chamados c
  WHERE ((c.id = chamados_mensagens.chamado_id) AND ((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(c.segmento,
        CASE
            WHEN (c.user_id IS NULL) THEN 'curioso'::text
            ELSE 'outro'::text
        END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text]))))))))
  );

-- comissoes
DROP POLICY IF EXISTS "Admin gerencia comissões" ON public.comissoes;

DROP POLICY IF EXISTS "comissoes_select_consolidada" ON public.comissoes;

CREATE POLICY "comissoes_select_consolidada" ON public.comissoes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR ((is_admin() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = beneficiario_id)))
  );

CREATE POLICY "comissoes_insert_consolidada" ON public.comissoes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "comissoes_update_consolidada" ON public.comissoes
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  is_admin()
  )
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "comissoes_delete_consolidada" ON public.comissoes
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- config_financeira
DROP POLICY IF EXISTS "cfg_fin_admin_all" ON public.config_financeira;

DROP POLICY IF EXISTS "cfg_fin_select" ON public.config_financeira;

CREATE POLICY "config_financeira_select_consolidada" ON public.config_financeira
  AS PERMISSIVE FOR SELECT TO public
  USING (
  is_admin()
  );

CREATE POLICY "config_financeira_insert_consolidada" ON public.config_financeira
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "config_financeira_update_consolidada" ON public.config_financeira
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  is_admin()
  )
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "config_financeira_delete_consolidada" ON public.config_financeira
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- config_honorarios
DROP POLICY IF EXISTS "config_honorarios_admin_write" ON public.config_honorarios;

DROP POLICY IF EXISTS "config_honorarios_select" ON public.config_honorarios;

CREATE POLICY "config_honorarios_select_consolidada" ON public.config_honorarios
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  OR (true)
  );

CREATE POLICY "config_honorarios_insert_consolidada" ON public.config_honorarios
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "config_honorarios_update_consolidada" ON public.config_honorarios
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "config_honorarios_delete_consolidada" ON public.config_honorarios
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

-- contratos
DROP POLICY IF EXISTS "contratos_all_consolidada" ON public.contratos;

DROP POLICY IF EXISTS "contratos_select_consolidada" ON public.contratos;

DROP POLICY IF EXISTS "Cliente assina contrato" ON public.contratos;

CREATE POLICY "contratos_select_consolidada" ON public.contratos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((is_admin() OR (cliente_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))))
  OR (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id) OR is_equipe()))
  );

CREATE POLICY "contratos_insert_consolidada" ON public.contratos
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (is_admin() OR (cliente_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

CREATE POLICY "contratos_update_consolidada" ON public.contratos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  ((is_admin() OR (cliente_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id))
  )
  WITH CHECK (
  ((is_admin() OR (cliente_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id))
  );

CREATE POLICY "contratos_delete_consolidada" ON public.contratos
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (is_admin() OR (cliente_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

-- contratos_link
DROP POLICY IF EXISTS "contratos_link_all_consolidada" ON public.contratos_link;

DROP POLICY IF EXISTS "Assinante lê próprios contratos_link" ON public.contratos_link;

DROP POLICY IF EXISTS "Assinante pode assinar próprio contrato_link" ON public.contratos_link;

CREATE POLICY "contratos_link_select_consolidada" ON public.contratos_link
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por) OR is_equipe()))
  OR ((assinante_email = ( SELECT ( SELECT auth.email() AS email) AS email)))
  );

CREATE POLICY "contratos_link_insert_consolidada" ON public.contratos_link
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por) OR is_equipe())
  );

CREATE POLICY "contratos_link_update_consolidada" ON public.contratos_link
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por) OR is_equipe()))
  OR (((assinante_email = ( SELECT ( SELECT auth.email() AS email) AS email)) AND (status = 'aguardando'::text)))
  )
  WITH CHECK (
  (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por) OR is_equipe()))
  OR (((assinante_email = ( SELECT ( SELECT auth.email() AS email) AS email)) AND (status = 'aguardando'::text)))
  );

CREATE POLICY "contratos_link_delete_consolidada" ON public.contratos_link
  AS PERMISSIVE FOR DELETE TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por) OR is_equipe())
  );

-- contratos_pendentes
DROP POLICY IF EXISTS "contratos_pendentes_all_consolidada" ON public.contratos_pendentes;

DROP POLICY IF EXISTS "Usuario ve proprios contratos pendentes" ON public.contratos_pendentes;

CREATE POLICY "contratos_pendentes_select_consolidada" ON public.contratos_pendentes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))) OR (user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

CREATE POLICY "contratos_pendentes_insert_consolidada" ON public.contratos_pendentes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))) OR (user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

CREATE POLICY "contratos_pendentes_update_consolidada" ON public.contratos_pendentes
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))) OR (user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  )
  WITH CHECK (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))) OR (user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

CREATE POLICY "contratos_pendentes_delete_consolidada" ON public.contratos_pendentes
  AS PERMISSIVE FOR DELETE TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))) OR (user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

-- cotas_analise
DROP POLICY IF EXISTS "cotas_admin_all" ON public.cotas_analise;

DROP POLICY IF EXISTS "cotas_proprio" ON public.cotas_analise;

DROP POLICY IF EXISTS "cotas_analise_proprio_ins" ON public.cotas_analise;

DROP POLICY IF EXISTS "cotas_analise_proprio_upd" ON public.cotas_analise;

CREATE POLICY "cotas_analise_select_consolidada" ON public.cotas_analise
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = usuario_id))
  );

CREATE POLICY "cotas_analise_insert_consolidada" ON public.cotas_analise
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (is_admin())
  OR ((usuario_id = ( SELECT auth.uid() AS uid)))
  );

CREATE POLICY "cotas_analise_update_consolidada" ON public.cotas_analise
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_admin())
  OR ((usuario_id = ( SELECT auth.uid() AS uid)))
  )
  WITH CHECK (
  (is_admin())
  OR ((usuario_id = ( SELECT auth.uid() AS uid)))
  );

CREATE POLICY "cotas_analise_delete_consolidada" ON public.cotas_analise
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- curso_modulos
DROP POLICY IF EXISTS "Admin gerencia modulos" ON public.curso_modulos;

DROP POLICY IF EXISTS "Leitura publica modulos" ON public.curso_modulos;

CREATE POLICY "curso_modulos_select_consolidada" ON public.curso_modulos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))
  OR (true)
  );

CREATE POLICY "curso_modulos_insert_consolidada" ON public.curso_modulos
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "curso_modulos_update_consolidada" ON public.curso_modulos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "curso_modulos_delete_consolidada" ON public.curso_modulos
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );


-- cursos
DROP POLICY IF EXISTS "Admin gerencia cursos" ON public.cursos;

DROP POLICY IF EXISTS "Qualquer um lê cursos ativos" ON public.cursos;

CREATE POLICY "cursos_select_consolidada" ON public.cursos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))
  OR ((ativo = true))
  );

CREATE POLICY "cursos_insert_consolidada" ON public.cursos
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "cursos_update_consolidada" ON public.cursos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "cursos_delete_consolidada" ON public.cursos
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

-- cursos_admin
DROP POLICY IF EXISTS "Admin gerencia cursos" ON public.cursos_admin;

DROP POLICY IF EXISTS "Leitura publica cursos" ON public.cursos_admin;

CREATE POLICY "cursos_admin_select_consolidada" ON public.cursos_admin
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  OR (true)
  );

CREATE POLICY "cursos_admin_insert_consolidada" ON public.cursos_admin
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "cursos_admin_update_consolidada" ON public.cursos_admin
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "cursos_admin_delete_consolidada" ON public.cursos_admin
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

-- ebooks_admin
DROP POLICY IF EXISTS "Admin gerencia ebooks" ON public.ebooks_admin;

DROP POLICY IF EXISTS "Leitura publica ebooks" ON public.ebooks_admin;

CREATE POLICY "ebooks_admin_select_consolidada" ON public.ebooks_admin
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  OR (true)
  );

CREATE POLICY "ebooks_admin_insert_consolidada" ON public.ebooks_admin
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "ebooks_admin_update_consolidada" ON public.ebooks_admin
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "ebooks_admin_delete_consolidada" ON public.ebooks_admin
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

-- filtros_salvos
DROP POLICY IF EXISTS "fs_proprios" ON public.filtros_salvos;

DROP POLICY IF EXISTS "fs_select_staff" ON public.filtros_salvos;

CREATE POLICY "filtros_salvos_select_consolidada" ON public.filtros_salvos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['admin'::text, 'analista'::text, 'consultor'::text, 'advogado'::text]))))))
  );

CREATE POLICY "filtros_salvos_insert_consolidada" ON public.filtros_salvos
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "filtros_salvos_update_consolidada" ON public.filtros_salvos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  )
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "filtros_salvos_delete_consolidada" ON public.filtros_salvos
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

-- imoveis
DROP POLICY IF EXISTS "Usuário vê próprios imóveis" ON public.imoveis;

DROP POLICY IF EXISTS "Gestor/assessor vê clientes" ON public.imoveis;

CREATE POLICY "imoveis_select_consolidada" ON public.imoveis
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['admin'::text, 'assessor'::text, 'gestor'::text]))))))
  );

CREATE POLICY "imoveis_insert_consolidada" ON public.imoveis
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "imoveis_update_consolidada" ON public.imoveis
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  )
  WITH CHECK (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

CREATE POLICY "imoveis_delete_consolidada" ON public.imoveis
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id)
  );

-- imoveis_leilao
DROP POLICY IF EXISTS "Service role gerencia imoveis" ON public.imoveis_leilao;

DROP POLICY IF EXISTS "Leitura pública imoveis_leilao" ON public.imoveis_leilao;

CREATE POLICY "imoveis_leilao_select_consolidada" ON public.imoveis_leilao
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.role() AS role) AS role) = 'service_role'::text))
  OR (true)
  );

CREATE POLICY "imoveis_leilao_insert_consolidada" ON public.imoveis_leilao
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (( SELECT ( SELECT auth.role() AS role) AS role) = 'service_role'::text)
  );

CREATE POLICY "imoveis_leilao_update_consolidada" ON public.imoveis_leilao
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (( SELECT ( SELECT auth.role() AS role) AS role) = 'service_role'::text)
  )
  WITH CHECK (
  (( SELECT ( SELECT auth.role() AS role) AS role) = 'service_role'::text)
  );

CREATE POLICY "imoveis_leilao_delete_consolidada" ON public.imoveis_leilao
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (( SELECT ( SELECT auth.role() AS role) AS role) = 'service_role'::text)
  );

-- licoes
DROP POLICY IF EXISTS "Admin gerencia lições" ON public.licoes;

DROP POLICY IF EXISTS "Qualquer um lê lições" ON public.licoes;

CREATE POLICY "licoes_select_consolidada" ON public.licoes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))
  OR (true)
  );

CREATE POLICY "licoes_insert_consolidada" ON public.licoes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "licoes_update_consolidada" ON public.licoes
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "licoes_delete_consolidada" ON public.licoes
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

-- links_convite
DROP POLICY IF EXISTS "links_convite_all_consolidada" ON public.links_convite;

DROP POLICY IF EXISTS "Público lê convites ativos" ON public.links_convite;

CREATE POLICY "links_convite_select_consolidada" ON public.links_convite
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((is_equipe() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por)))
  OR ((ativo = true))
  );

CREATE POLICY "links_convite_insert_consolidada" ON public.links_convite
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (is_equipe() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  );

CREATE POLICY "links_convite_update_consolidada" ON public.links_convite
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_equipe() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  )
  WITH CHECK (
  (is_equipe() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  );

CREATE POLICY "links_convite_delete_consolidada" ON public.links_convite
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (is_equipe() OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  );

-- links_promo
DROP POLICY IF EXISTS "Admin gerencia links_promo" ON public.links_promo;

DROP POLICY IF EXISTS "links_promo_select_consolidada" ON public.links_promo;

DROP POLICY IF EXISTS "Consultor/afiliado cria links" ON public.links_promo;

DROP POLICY IF EXISTS "Consultor desativa próprios links" ON public.links_promo;

CREATE POLICY "links_promo_select_consolidada" ON public.links_promo
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por) OR (ativo = true)))
  );

CREATE POLICY "links_promo_insert_consolidada" ON public.links_promo
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (is_admin())
  OR (((( SELECT auth.uid() AS uid) = criado_por) AND (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['consultor'::text, 'afiliado'::text])))))))
  );

CREATE POLICY "links_promo_update_consolidada" ON public.links_promo
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  )
  WITH CHECK (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  );

CREATE POLICY "links_promo_delete_consolidada" ON public.links_promo
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- modulos
DROP POLICY IF EXISTS "Admin gerencia módulos" ON public.modulos;

DROP POLICY IF EXISTS "Qualquer um lê módulos" ON public.modulos;

CREATE POLICY "modulos_select_consolidada" ON public.modulos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))
  OR (true)
  );

CREATE POLICY "modulos_insert_consolidada" ON public.modulos
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "modulos_update_consolidada" ON public.modulos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "modulos_delete_consolidada" ON public.modulos
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

-- preco_contratado
DROP POLICY IF EXISTS "pc_admin" ON public.preco_contratado;

DROP POLICY IF EXISTS "pc_proprio" ON public.preco_contratado;

CREATE POLICY "preco_contratado_select_consolidada" ON public.preco_contratado
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

CREATE POLICY "preco_contratado_insert_consolidada" ON public.preco_contratado
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "preco_contratado_update_consolidada" ON public.preco_contratado
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "preco_contratado_delete_consolidada" ON public.preco_contratado
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

-- procuracoes
DROP POLICY IF EXISTS "procuracoes_admin" ON public.procuracoes;

DROP POLICY IF EXISTS "procuracoes_select_consolidada" ON public.procuracoes;

DROP POLICY IF EXISTS "procuracoes_cliente_ins" ON public.procuracoes;

DROP POLICY IF EXISTS "procuracoes_cliente_upd" ON public.procuracoes;

CREATE POLICY "procuracoes_select_consolidada" ON public.procuracoes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR ((((( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id) AND (assinado = true)) OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id)))
  );

CREATE POLICY "procuracoes_insert_consolidada" ON public.procuracoes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (is_admin())
  OR ((cliente_id = ( SELECT auth.uid() AS uid)))
  );

CREATE POLICY "procuracoes_update_consolidada" ON public.procuracoes
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_admin())
  OR ((cliente_id = ( SELECT auth.uid() AS uid)))
  )
  WITH CHECK (
  (is_admin())
  OR ((cliente_id = ( SELECT auth.uid() AS uid)))
  );

CREATE POLICY "procuracoes_delete_consolidada" ON public.procuracoes
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- promocoes
DROP POLICY IF EXISTS "Admin gerencia promoções" ON public.promocoes;

DROP POLICY IF EXISTS "Qualquer um lê promoções ativas" ON public.promocoes;

CREATE POLICY "promocoes_select_consolidada" ON public.promocoes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))
  OR ((ativo = true))
  );

CREATE POLICY "promocoes_insert_consolidada" ON public.promocoes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "promocoes_update_consolidada" ON public.promocoes
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

CREATE POLICY "promocoes_delete_consolidada" ON public.promocoes
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text))))
  );

-- reunioes
DROP POLICY IF EXISTS "reunioes_admin" ON public.reunioes;

DROP POLICY IF EXISTS "reunioes_participantes" ON public.reunioes;

CREATE POLICY "reunioes_select_consolidada" ON public.reunioes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = analista_id) OR (( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id)))
  );

CREATE POLICY "reunioes_insert_consolidada" ON public.reunioes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "reunioes_update_consolidada" ON public.reunioes
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  is_admin()
  )
  WITH CHECK (
  is_admin()
  );

CREATE POLICY "reunioes_delete_consolidada" ON public.reunioes
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_admin()
  );

-- sdr_leads
DROP POLICY IF EXISTS "sdr_leads_all_consolidada" ON public.sdr_leads;

DROP POLICY IF EXISTS "sdr_leads_select_consolidada" ON public.sdr_leads;

CREATE POLICY "sdr_leads_select_consolidada" ON public.sdr_leads
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  OR (((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'analista'::text)))) OR (consultor_id = ( SELECT auth.uid() AS uid))))
  );

CREATE POLICY "sdr_leads_insert_consolidada" ON public.sdr_leads
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "sdr_leads_update_consolidada" ON public.sdr_leads
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "sdr_leads_delete_consolidada" ON public.sdr_leads
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

-- sdr_produtos
DROP POLICY IF EXISTS "produtos_admin" ON public.sdr_produtos;

DROP POLICY IF EXISTS "produtos_leitura_publica" ON public.sdr_produtos;

CREATE POLICY "sdr_produtos_select_consolidada" ON public.sdr_produtos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  OR ((ativo = true))
  );

CREATE POLICY "sdr_produtos_insert_consolidada" ON public.sdr_produtos
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text])))))
  );

CREATE POLICY "sdr_produtos_update_consolidada" ON public.sdr_produtos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text])))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text])))))
  );

CREATE POLICY "sdr_produtos_delete_consolidada" ON public.sdr_produtos
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text])))))
  );

-- tour_etapas
DROP POLICY IF EXISTS "Admin gerencia etapas" ON public.tour_etapas;

DROP POLICY IF EXISTS "Público lê etapas ativas" ON public.tour_etapas;

CREATE POLICY "tour_etapas_select_consolidada" ON public.tour_etapas
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_equipe())
  OR ((ativo = true))
  );

CREATE POLICY "tour_etapas_insert_consolidada" ON public.tour_etapas
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  is_equipe()
  );

CREATE POLICY "tour_etapas_update_consolidada" ON public.tour_etapas
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  is_equipe()
  )
  WITH CHECK (
  is_equipe()
  );

CREATE POLICY "tour_etapas_delete_consolidada" ON public.tour_etapas
  AS PERMISSIVE FOR DELETE TO public
  USING (
  is_equipe()
  );

-- veiculos_leilao
DROP POLICY IF EXISTS "Service role gerencia veiculos_leilao" ON public.veiculos_leilao;

DROP POLICY IF EXISTS "Leitura pública veiculos_leilao" ON public.veiculos_leilao;

CREATE POLICY "veiculos_leilao_select_consolidada" ON public.veiculos_leilao
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT auth.role() AS role) = 'service_role'::text))
  OR (true)
  );

CREATE POLICY "veiculos_leilao_insert_consolidada" ON public.veiculos_leilao
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  (( SELECT auth.role() AS role) = 'service_role'::text)
  );

CREATE POLICY "veiculos_leilao_update_consolidada" ON public.veiculos_leilao
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (( SELECT auth.role() AS role) = 'service_role'::text)
  )
  WITH CHECK (
  (( SELECT auth.role() AS role) = 'service_role'::text)
  );

CREATE POLICY "veiculos_leilao_delete_consolidada" ON public.veiculos_leilao
  AS PERMISSIVE FOR DELETE TO public
  USING (
  (( SELECT auth.role() AS role) = 'service_role'::text)
  );


COMMIT;
