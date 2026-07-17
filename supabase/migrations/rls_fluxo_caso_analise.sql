-- Corrige RLS que bloqueia o fluxo do cliente "solicitar análise" (src/pages/Caso.jsx).
-- Mesma classe do bug casos_cliente_insert: mutações client-side (JWT do usuário, sujeitas
-- a RLS) sem política correspondente. Confirmado sob RLS: insert do cliente batia em 42501.
--
-- Contexto de quota: cotas_analise/analise_jobs NÃO são gatilhados no servidor (api/) — a
-- cota é advisória/client-side (a geração real usa perfis.analises_count). Logo a política
-- de escrita própria em cotas_analise é consistente com o padrão owner-write do app e não
-- abre bypass novo.

-- 1) analise_jobs: participante do caso (cliente/analista/advogado) cria o job do PRÓPRIO caso.
--    Antes só existia jobs_admin_all → insert do cliente batia em RLS.
drop policy if exists analise_jobs_participante_insert on public.analise_jobs;
create policy analise_jobs_participante_insert on public.analise_jobs
  for insert to public
  with check (exists (
    select 1 from public.casos c
    where c.id = caso_id
      and (c.cliente_id = auth.uid() or c.analista_id = auth.uid() or c.advogado_id = auth.uid())
  ));

-- 2) cotas_analise: contador de análises do mês escrito pelo próprio usuário (espelha o
--    SELECT cotas_proprio). O upsert usa ON CONFLICT DO UPDATE → precisa de INSERT e UPDATE.
drop policy if exists cotas_analise_proprio_ins on public.cotas_analise;
create policy cotas_analise_proprio_ins on public.cotas_analise
  for insert to public with check (usuario_id = auth.uid());
drop policy if exists cotas_analise_proprio_upd on public.cotas_analise;
create policy cotas_analise_proprio_upd on public.cotas_analise
  for update to public using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
