-- 23/09: achado pelo Supabase Advisor (lint auth_rls_initplan, PERFORMANCE) — 11 policies
-- chamavam auth.uid()/auth.role() cru, que o Postgres reavalia LINHA A LINHA. Envolver em
-- `(select ...)` deixa o otimizador tratar como InitPlan (avaliado 1x por consulta, não por
-- linha) — puro ganho de performance em tabelas que crescem (honorarios_recebimentos,
-- cobrancas_avulsas, analises_veiculo, leiloeiro_site_descoberto), ZERO mudança de
-- comportamento/segurança (mesma lógica, só a forma de avaliar muda).
alter policy "analises_veiculo_insert" on public.analises_veiculo
  with check ((select auth.uid()) = user_id);

alter policy "analises_veiculo_select_consolidada" on public.analises_veiculo
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from perfis p where p.id = (select auth.uid()) and p.role = any (array['admin','analista']))
  );

alter policy "analises_veiculo_update" on public.analises_veiculo
  using ((select auth.uid()) = user_id);

alter policy "cobrancas_avulsas_select" on public.cobrancas_avulsas
  using (exists (select 1 from perfis p where p.id = (select auth.uid()) and p.role = any (array['admin','analista'])));

alter policy "cobrancas_avulsas_update" on public.cobrancas_avulsas
  using (exists (select 1 from perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy "cobrancas_avulsas_write" on public.cobrancas_avulsas
  with check (exists (select 1 from perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy "honorarios_recebimentos_delete" on public.honorarios_recebimentos
  using (exists (select 1 from perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy "honorarios_recebimentos_select" on public.honorarios_recebimentos
  using (exists (select 1 from perfis p where p.id = (select auth.uid()) and p.role = any (array['admin','analista','advogado'])));

alter policy "honorarios_recebimentos_update" on public.honorarios_recebimentos
  using (exists (select 1 from perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy "honorarios_recebimentos_write" on public.honorarios_recebimentos
  with check (exists (select 1 from perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy "leiloeiro_site_descoberto_service_only" on public.leiloeiro_site_descoberto
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
