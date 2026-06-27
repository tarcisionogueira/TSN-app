-- ════════════════════════════════════════════════════════════════════════════
-- SEGURANÇA (auditoria) — aplicada via Supabase MCP em produção
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Views SECURITY DEFINER furavam o RLS das tabelas-base → security_invoker
ALTER VIEW public.precos_vigentes          SET (security_invoker = on);
ALTER VIEW public.casos_sla_monitor        SET (security_invoker = on);
ALTER VIEW public.assinantes_preco_travado SET (security_invoker = on);
REVOKE ALL ON public.precos_vigentes          FROM anon, authenticated;
REVOKE ALL ON public.casos_sla_monitor        FROM anon, authenticated;
REVOKE ALL ON public.assinantes_preco_travado FROM anon, authenticated;

-- 2) Tabelas com RLS sem política retornavam vazio ao cliente (quebrava agendamento/honorários)
CREATE POLICY config_honorarios_select ON public.config_honorarios
  FOR SELECT TO authenticated USING (true);
CREATE POLICY config_honorarios_admin_write ON public.config_honorarios
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY slots_reuniao_select ON public.slots_reuniao
  FOR SELECT TO authenticated USING (true);
CREATE POLICY disponibilidade_admin_analista ON public.disponibilidade_analista
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista')));

-- 3) Pina search_path nas 14 funções da aplicação (anti-hijack; crítico nas SECURITY DEFINER)
ALTER FUNCTION public.buscar_por_raio(double precision, double precision, double precision, integer, integer, text, text, text, double precision, double precision) SET search_path = public;
ALTER FUNCTION public.calcular_multa_cancelamento(uuid) SET search_path = public;
ALTER FUNCTION public.conceder_extras_analise(uuid, uuid, integer) SET search_path = public;
ALTER FUNCTION public.expirar_contratos_link() SET search_path = public;
ALTER FUNCTION public.fn_checklist_completo() SET search_path = public;
ALTER FUNCTION public.fn_prazo_processual() SET search_path = public;
ALTER FUNCTION public.fn_set_updated_at() SET search_path = public;
ALTER FUNCTION public.handle_updated_at() SET search_path = public;
ALTER FUNCTION public.limpar_system_health() SET search_path = public;
ALTER FUNCTION public.obter_cota_analise(uuid, text) SET search_path = public;
ALTER FUNCTION public.preco_vigente(uuid, text) SET search_path = public;
ALTER FUNCTION public.registrar_preco_contratado(uuid, text) SET search_path = public;
ALTER FUNCTION public.set_caso_prazos() SET search_path = public;
ALTER FUNCTION public.solicitar_saque(uuid, numeric) SET search_path = public;
