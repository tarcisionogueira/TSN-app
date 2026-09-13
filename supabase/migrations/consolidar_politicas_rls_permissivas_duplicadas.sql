BEGIN;

-- aceites_plano/SELECT: 2 políticas -> merge OR em 1 (aceites_plano_select_consolidada)

DROP POLICY IF EXISTS "Admin le aceites" ON public.aceites_plano;

DROP POLICY IF EXISTS "Usuario ve proprio aceite" ON public.aceites_plano;

CREATE POLICY "aceites_plano_select_consolidada" ON public.aceites_plano
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- agendamentos/SELECT: 2 políticas -> merge OR em 1 (agendamentos_select_consolidada)

DROP POLICY IF EXISTS "Analista/admin vê todos agendamentos" ON public.agendamentos;

DROP POLICY IF EXISTS "Cliente vê próprios agendamentos" ON public.agendamentos;

CREATE POLICY "agendamentos_select_consolidada" ON public.agendamentos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- agendamentos/UPDATE: 2 políticas -> merge OR em 1 (agendamentos_update_consolidada)

DROP POLICY IF EXISTS "Analista/admin aprova agendamento" ON public.agendamentos;

DROP POLICY IF EXISTS "Cliente atualiza próprio agendamento" ON public.agendamentos;

CREATE POLICY "agendamentos_update_consolidada" ON public.agendamentos
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  )
  WITH CHECK (
  (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- analise_juridica/ALL: 2 políticas -> merge OR em 1 (analise_juridica_all_consolidada)

DROP POLICY IF EXISTS "juridica_admin" ON public.analise_juridica;

DROP POLICY IF EXISTS "juridica_advogado" ON public.analise_juridica;

CREATE POLICY "analise_juridica_all_consolidada" ON public.analise_juridica
  AS PERMISSIVE FOR ALL TO public
  USING (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id))
  )
  WITH CHECK (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id))
  );

-- analise_juridica/SELECT: 2 políticas -> merge OR em 1 (analise_juridica_select_consolidada)

DROP POLICY IF EXISTS "juridica_analista" ON public.analise_juridica;

DROP POLICY IF EXISTS "juridica_cliente" ON public.analise_juridica;

CREATE POLICY "analise_juridica_select_consolidada" ON public.analise_juridica
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM casos
  WHERE ((casos.id = analise_juridica.caso_id) AND (casos.analista_id = ( SELECT auth.uid() AS uid))))))
  OR (((entregue_em IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM casos
  WHERE ((casos.id = analise_juridica.caso_id) AND (casos.cliente_id = ( SELECT auth.uid() AS uid)))))))
  );

-- analise_relatorios/SELECT: 2 políticas -> merge OR em 1 (analise_relatorios_select_consolidada)

DROP POLICY IF EXISTS "relatorios_cliente" ON public.analise_relatorios;

DROP POLICY IF EXISTS "relatorios_equipe" ON public.analise_relatorios;

CREATE POLICY "analise_relatorios_select_consolidada" ON public.analise_relatorios
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM casos
  WHERE ((casos.id = analise_relatorios.caso_id) AND (casos.cliente_id = ( SELECT auth.uid() AS uid))))))
  OR ((EXISTS ( SELECT 1
   FROM casos
  WHERE ((casos.id = analise_relatorios.caso_id) AND ((casos.analista_id = ( SELECT auth.uid() AS uid)) OR (casos.advogado_id = ( SELECT auth.uid() AS uid)))))))
  );

-- analises_documental/SELECT: 2 políticas -> merge OR em 1 (analises_documental_select_consolidada)

DROP POLICY IF EXISTS "ad_select" ON public.analises_documental;

DROP POLICY IF EXISTS "ad_select_staff" ON public.analises_documental;

CREATE POLICY "analises_documental_select_consolidada" ON public.analises_documental
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text, 'consultor'::text, 'advogado'::text]))))))
  );

-- analises_laudo/SELECT: 2 políticas -> merge OR em 1 (analises_laudo_select_consolidada)

DROP POLICY IF EXISTS "al_select" ON public.analises_laudo;

DROP POLICY IF EXISTS "al_select_staff" ON public.analises_laudo;

CREATE POLICY "analises_laudo_select_consolidada" ON public.analises_laudo
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text, 'consultor'::text, 'advogado'::text]))))))
  );

-- analises_mercado/SELECT: 2 políticas -> merge OR em 1 (analises_mercado_select_consolidada)

DROP POLICY IF EXISTS "am_select" ON public.analises_mercado;

DROP POLICY IF EXISTS "am_select_staff" ON public.analises_mercado;

CREATE POLICY "analises_mercado_select_consolidada" ON public.analises_mercado
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text, 'consultor'::text, 'advogado'::text]))))))
  );

-- anexo_auditoria/SELECT: 2 políticas -> merge OR em 1 (anexo_auditoria_select_consolidada)

DROP POLICY IF EXISTS "anexo_auditoria_select_dono" ON public.anexo_auditoria;

DROP POLICY IF EXISTS "anexo_auditoria_select_staff" ON public.anexo_auditoria;

CREATE POLICY "anexo_auditoria_select_consolidada" ON public.anexo_auditoria
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
  ((EXISTS ( SELECT 1
   FROM arrematados a
  WHERE ((a.imovel_id = (anexo_auditoria.imovel_id)::text) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  OR ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['admin'::text, 'analista'::text, 'advogado'::text, 'consultor'::text]))))))
  );

-- arrematacoes/INSERT: 2 políticas -> merge OR em 1 (arrematacoes_insert_consolidada)

DROP POLICY IF EXISTS "arrematacoes_arrematante_ins" ON public.arrematacoes;

DROP POLICY IF EXISTS "arrematacoes_insert" ON public.arrematacoes;

CREATE POLICY "arrematacoes_insert_consolidada" ON public.arrematacoes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
  ((arrematante_id = ( SELECT auth.uid() AS uid)))
  OR ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  );

-- arrematacoes/UPDATE: 2 políticas -> merge OR em 1 (arrematacoes_update_consolidada)

DROP POLICY IF EXISTS "arrematacoes_arrematante_upd" ON public.arrematacoes;

DROP POLICY IF EXISTS "arrematacoes_update" ON public.arrematacoes;

CREATE POLICY "arrematacoes_update_consolidada" ON public.arrematacoes
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  ((arrematante_id = ( SELECT auth.uid() AS uid)))
  OR ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  )
  WITH CHECK (
  ((arrematante_id = ( SELECT auth.uid() AS uid)))
  OR ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  );

-- casos/SELECT: 3 políticas -> merge OR em 1 (casos_select_consolidada)

DROP POLICY IF EXISTS "casos_advogado" ON public.casos;

DROP POLICY IF EXISTS "casos_analista" ON public.casos;

DROP POLICY IF EXISTS "casos_cliente" ON public.casos;

CREATE POLICY "casos_select_consolidada" ON public.casos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = analista_id))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id))
  );

-- chamados/ALL: 2 políticas -> merge OR em 1 (chamados_all_consolidada)

DROP POLICY IF EXISTS "chamados_proprio_usuario" ON public.chamados;

DROP POLICY IF EXISTS "chamados_staff_escopo" ON public.chamados;

CREATE POLICY "chamados_all_consolidada" ON public.chamados
  AS PERMISSIVE FOR ALL TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR (((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text])))))
  )
  WITH CHECK (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR (((app_role() = 'admin'::text) OR ((app_role() = 'consultor'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['curioso'::text, 'explorador'::text, 'outro'::text]))) OR ((app_role() = 'analista'::text) AND (COALESCE(segmento,
CASE
    WHEN (user_id IS NULL) THEN 'curioso'::text
    ELSE 'outro'::text
END) = ANY (ARRAY['investidor'::text, 'assessorado'::text, 'clube'::text, 'interno'::text])))))
  );

-- chamados_mensagens/ALL: 2 políticas -> merge OR em 1 (chamados_mensagens_all_consolidada)

DROP POLICY IF EXISTS "mensagens_proprio_chamado" ON public.chamados_mensagens;

DROP POLICY IF EXISTS "mensagens_staff_escopo" ON public.chamados_mensagens;

CREATE POLICY "chamados_mensagens_all_consolidada" ON public.chamados_mensagens
  AS PERMISSIVE FOR ALL TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM chamados
  WHERE ((chamados.id = chamados_mensagens.chamado_id) AND (chamados.user_id = ( SELECT auth.uid() AS uid))))))
  OR ((EXISTS ( SELECT 1
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
  WHERE ((chamados.id = chamados_mensagens.chamado_id) AND (chamados.user_id = ( SELECT auth.uid() AS uid))))))
  OR ((EXISTS ( SELECT 1
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

-- comissoes/SELECT: 2 políticas -> merge OR em 1 (comissoes_select_consolidada)

DROP POLICY IF EXISTS "Admin vê todas comissões" ON public.comissoes;

DROP POLICY IF EXISTS "Beneficiário vê próprias comissões" ON public.comissoes;

CREATE POLICY "comissoes_select_consolidada" ON public.comissoes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = beneficiario_id))
  );

-- compras/SELECT: 2 políticas -> merge OR em 1 (compras_select_consolidada)

DROP POLICY IF EXISTS "Admin vê todas compras" ON public.compras;

DROP POLICY IF EXISTS "Usuário vê próprias compras" ON public.compras;

CREATE POLICY "compras_select_consolidada" ON public.compras
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- contratos/ALL: 2 políticas -> merge OR em 1 (contratos_all_consolidada)

DROP POLICY IF EXISTS "Admin gerencia contratos" ON public.contratos;

DROP POLICY IF EXISTS "contratos_own" ON public.contratos;

CREATE POLICY "contratos_all_consolidada" ON public.contratos
  AS PERMISSIVE FOR ALL TO public
  USING (
  (is_admin())
  OR ((cliente_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  )
  WITH CHECK (
  (is_admin())
  OR ((cliente_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

-- contratos/SELECT: 2 políticas -> merge OR em 1 (contratos_select_consolidada)

DROP POLICY IF EXISTS "Cliente vê contratos" ON public.contratos;

DROP POLICY IF EXISTS "Equipe vê contratos" ON public.contratos;

CREATE POLICY "contratos_select_consolidada" ON public.contratos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id))
  OR (is_equipe())
  );

-- contratos_link/ALL: 2 políticas -> merge OR em 1 (contratos_link_all_consolidada)

DROP POLICY IF EXISTS "Criador vê próprios contratos_link" ON public.contratos_link;

DROP POLICY IF EXISTS "Equipe gerencia contratos_link" ON public.contratos_link;

CREATE POLICY "contratos_link_all_consolidada" ON public.contratos_link
  AS PERMISSIVE FOR ALL TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  OR (is_equipe())
  )
  WITH CHECK (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  OR (is_equipe())
  );

-- contratos_pendentes/ALL: 2 políticas -> merge OR em 1 (contratos_pendentes_all_consolidada)

DROP POLICY IF EXISTS "Admin gerencia contratos pendentes" ON public.contratos_pendentes;

DROP POLICY IF EXISTS "contratos_pendentes_own" ON public.contratos_pendentes;

CREATE POLICY "contratos_pendentes_all_consolidada" ON public.contratos_pendentes
  AS PERMISSIVE FOR ALL TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  OR ((user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  )
  WITH CHECK (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  OR ((user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

-- credito_lancamentos/SELECT: 2 políticas -> merge OR em 1 (credito_lancamentos_select_consolidada)

DROP POLICY IF EXISTS "credito_lanc_admin" ON public.credito_lancamentos;

DROP POLICY IF EXISTS "credito_lanc_self" ON public.credito_lancamentos;

CREATE POLICY "credito_lancamentos_select_consolidada" ON public.credito_lancamentos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::text)))))
  OR ((( SELECT auth.uid() AS uid) = user_id))
  );

-- feedbacks/SELECT: 2 políticas -> merge OR em 1 (feedbacks_select_consolidada)

DROP POLICY IF EXISTS "Admin le feedbacks" ON public.feedbacks;

DROP POLICY IF EXISTS "Usuario ve proprios feedbacks" ON public.feedbacks;

CREATE POLICY "feedbacks_select_consolidada" ON public.feedbacks
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text]))))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- financiamentos/ALL: 2 políticas -> merge OR em 1 (financiamentos_all_consolidada)

DROP POLICY IF EXISTS "fin_admin" ON public.financiamentos;

DROP POLICY IF EXISTS "fin_proprio" ON public.financiamentos;

CREATE POLICY "financiamentos_all_consolidada" ON public.financiamentos
  AS PERMISSIVE FOR ALL TO public
  USING (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  )
  WITH CHECK (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- imoveis_leiloeiro/ALL: 2 políticas -> merge OR em 1 (imoveis_leiloeiro_all_consolidada)

DROP POLICY IF EXISTS "admin_all_leiloeiro" ON public.imoveis_leiloeiro;

DROP POLICY IF EXISTS "leiloeiro_own" ON public.imoveis_leiloeiro;

CREATE POLICY "imoveis_leiloeiro_all_consolidada" ON public.imoveis_leiloeiro
  AS PERMISSIVE FOR ALL TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  OR ((leiloeiro_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  )
  WITH CHECK (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  OR ((leiloeiro_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

-- imovel_anexos/SELECT: 3 políticas -> merge OR em 1 (imovel_anexos_select_consolidada)

DROP POLICY IF EXISTS "imovel_anexos_docs_imovel" ON public.imovel_anexos;

DROP POLICY IF EXISTS "imovel_anexos_meu_arremate_select" ON public.imovel_anexos;

DROP POLICY IF EXISTS "imovel_anexos_select" ON public.imovel_anexos;

CREATE POLICY "imovel_anexos_select_consolidada" ON public.imovel_anexos
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (((( SELECT ( SELECT auth.uid() AS uid) AS uid) IS NOT NULL) AND ((tipo)::text = ANY (ARRAY['matricula'::text, 'edital'::text, 'regras_venda'::text]))))
  OR ((EXISTS ( SELECT 1
   FROM arrematados a
  WHERE ((a.imovel_id = (imovel_anexos.imovel_id)::text) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  OR (((EXISTS ( SELECT 1
   FROM arrematacoes a
  WHERE ((a.id = imovel_anexos.arrematacao_id) AND (a.arrematante_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = ANY (ARRAY['admin'::text, 'analista'::text, 'advogado'::text])))))))
  );

-- links_convite/ALL: 2 políticas -> merge OR em 1 (links_convite_all_consolidada)

DROP POLICY IF EXISTS "Equipe gerencia todos os convites" ON public.links_convite;

DROP POLICY IF EXISTS "Usuário gerencia próprios convites" ON public.links_convite;

CREATE POLICY "links_convite_all_consolidada" ON public.links_convite
  AS PERMISSIVE FOR ALL TO public
  USING (
  (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  )
  WITH CHECK (
  (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  );

-- links_promo/SELECT: 2 políticas -> merge OR em 1 (links_promo_select_consolidada)

DROP POLICY IF EXISTS "Consultor vê próprios links" ON public.links_promo;

DROP POLICY IF EXISTS "Público lê links ativos" ON public.links_promo;

CREATE POLICY "links_promo_select_consolidada" ON public.links_promo
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = criado_por))
  OR ((ativo = true))
  );

-- live_inscricoes/SELECT: 2 políticas -> merge OR em 1 (live_inscricoes_select_consolidada)

DROP POLICY IF EXISTS "live_inscricoes_dono" ON public.live_inscricoes;

DROP POLICY IF EXISTS "live_inscricoes_equipe" ON public.live_inscricoes;

CREATE POLICY "live_inscricoes_select_consolidada" ON public.live_inscricoes
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
  ((user_id = (select auth.uid())))
  OR ((is_admin() OR (EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['admin'::text, 'analista'::text])))))))
  );

-- mensagens_diretas/SELECT: 2 políticas -> merge OR em 1 (mensagens_diretas_select_consolidada)

DROP POLICY IF EXISTS "cliente_le_proprias" ON public.mensagens_diretas;

DROP POLICY IF EXISTS "consultor_le_enviadas" ON public.mensagens_diretas;

CREATE POLICY "mensagens_diretas_select_consolidada" ON public.mensagens_diretas
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = para_user_id))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = de_consultor_id))
  );

-- perfis/SELECT: 5 políticas -> merge OR em 1 (perfis_select_consolidada)

DROP POLICY IF EXISTS "Admin lê todos os perfis" ON public.perfis;

DROP POLICY IF EXISTS "Consultor vê carteira" ON public.perfis;

DROP POLICY IF EXISTS "Equipe lê perfis" ON public.perfis;

DROP POLICY IF EXISTS "Leitura proprio perfil" ON public.perfis;

DROP POLICY IF EXISTS "Usuário lê próprio perfil" ON public.perfis;

CREATE POLICY "perfis_select_consolidada" ON public.perfis
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_admin())
  OR ((indicado_por = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  OR (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = id))
  );

-- perfis/UPDATE: 2 políticas -> merge OR em 1 (perfis_update_consolidada)

DROP POLICY IF EXISTS "Admin atualiza perfis" ON public.perfis;

DROP POLICY IF EXISTS "Usuário atualiza próprio perfil" ON public.perfis;

CREATE POLICY "perfis_update_consolidada" ON public.perfis
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = id))
  )
  WITH CHECK (
  (is_admin())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = id))
  );

-- perguntas/SELECT: 2 políticas -> merge OR em 1 (perguntas_select_consolidada)

DROP POLICY IF EXISTS "Admin/assessor vê todas" ON public.perguntas;

DROP POLICY IF EXISTS "Usuário vê próprias perguntas" ON public.perguntas;

CREATE POLICY "perguntas_select_consolidada" ON public.perguntas
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['admin'::text, 'assessor'::text, 'atendente'::text]))))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- procuracoes/SELECT: 2 políticas -> merge OR em 1 (procuracoes_select_consolidada)

DROP POLICY IF EXISTS "procuracoes_advogado" ON public.procuracoes;

DROP POLICY IF EXISTS "procuracoes_cliente" ON public.procuracoes;

CREATE POLICY "procuracoes_select_consolidada" ON public.procuracoes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = advogado_id) AND (assinado = true)))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = cliente_id))
  );

-- progresso/ALL: 2 políticas -> merge OR em 1 (progresso_all_consolidada)

DROP POLICY IF EXISTS "Usuário vê próprio progresso" ON public.progresso;

DROP POLICY IF EXISTS "progresso_own" ON public.progresso;

CREATE POLICY "progresso_all_consolidada" ON public.progresso
  AS PERMISSIVE FOR ALL TO public
  USING (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  )
  WITH CHECK (
  ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  OR ((user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)))
  );

-- relatorios/SELECT: 2 políticas -> merge OR em 1 (relatorios_select_consolidada)

DROP POLICY IF EXISTS "Analista/admin vê todos relatórios" ON public.relatorios;

DROP POLICY IF EXISTS "Cliente vê próprios relatórios" ON public.relatorios;

CREATE POLICY "relatorios_select_consolidada" ON public.relatorios
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['analista'::text, 'advogado'::text, 'admin'::text]))))))
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- sdr_leads/ALL: 2 políticas idênticas -> vira 1 (sdr_leads_all_consolidada)

DROP POLICY IF EXISTS "leads_admin" ON public.sdr_leads;

DROP POLICY IF EXISTS "sdr_leads_admin" ON public.sdr_leads;

CREATE POLICY "sdr_leads_all_consolidada" ON public.sdr_leads
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text)))));

-- sdr_leads/SELECT: 2 políticas -> merge OR em 1 (sdr_leads_select_consolidada)

DROP POLICY IF EXISTS "leads_analista_leitura" ON public.sdr_leads;

DROP POLICY IF EXISTS "leads_dono_leitura" ON public.sdr_leads;

CREATE POLICY "sdr_leads_select_consolidada" ON public.sdr_leads
  AS PERMISSIVE FOR SELECT TO public
  USING (
  ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'analista'::text)))))
  OR ((consultor_id = ( SELECT auth.uid() AS uid)))
  );

-- solicitacoes/SELECT: 2 políticas -> merge OR em 1 (solicitacoes_select_consolidada)

DROP POLICY IF EXISTS "Analista/admin vê todas" ON public.solicitacoes;

DROP POLICY IF EXISTS "Cliente vê próprias solicitações" ON public.solicitacoes;

CREATE POLICY "solicitacoes_select_consolidada" ON public.solicitacoes
  AS PERMISSIVE FOR SELECT TO public
  USING (
  (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );

-- solicitacoes/UPDATE: 2 políticas -> merge OR em 1 (solicitacoes_update_consolidada)

DROP POLICY IF EXISTS "Analista/admin atualiza" ON public.solicitacoes;

DROP POLICY IF EXISTS "Cliente cancela própria solicitação" ON public.solicitacoes;

CREATE POLICY "solicitacoes_update_consolidada" ON public.solicitacoes
  AS PERMISSIVE FOR UPDATE TO public
  USING (
  (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  )
  WITH CHECK (
  (is_equipe())
  OR ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id))
  );
-- ─── auth_rls_initplan: auth.uid() reavaliado por linha (fora dos grupos consolidados acima) ───

ALTER POLICY "onr_owner_or_admin" ON public.onr_protocolos
  USING ((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = (select auth.uid())) AND (perfis.role = 'admin'::text)))))
  WITH CHECK ((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = (select auth.uid())) AND (perfis.role = 'admin'::text)))));

ALTER POLICY "analise_jobs_participante_select" ON public.analise_jobs
  USING (EXISTS ( SELECT 1
   FROM casos c
  WHERE ((c.id = analise_jobs.caso_id) AND ((c.cliente_id = (select auth.uid())) OR (c.analista_id = (select auth.uid())) OR (c.advogado_id = (select auth.uid()))))));

ALTER POLICY "Admin gerencia capitulos" ON public.ebook_capitulos
  USING (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = (select auth.uid())) AND (perfis.role = 'admin'::text))));

ALTER POLICY "mensagens_grupo_log_admin_select" ON public.mensagens_grupo_log
  USING (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = (select auth.uid())) AND (perfis.role = 'admin'::text))));

COMMIT;
