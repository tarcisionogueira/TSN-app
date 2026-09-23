-- 23/09: achado pelo Supabase Advisor (lint rls_disabled_in_public, nível ERROR) — `fipe_uso`
-- foi criada (20/09, fipe_uso_teto_diario.sql) sem RLS, diferente da irmã `brightdata_uso`
-- (mesmo padrão de trava de custo). Com RLS desligada e os grants padrão de anon/authenticated
-- do schema public (SELECT/INSERT/UPDATE/DELETE), QUALQUER visitante anônimo podia ler ou
-- adulterar o contador de cota da FIPE via PostgREST (`/rest/v1/fipe_uso`) — só
-- `registrar_uso_fipe()` (SECURITY DEFINER) deveria tocar nesta tabela. Mesma correção que
-- `brightdata_uso` já tem: RLS ligada, ZERO policies (fail-closed) — só service_role (que
-- ignora RLS) e o dono da função SECURITY DEFINER continuam funcionando; nenhuma mudança de
-- comportamento para o app.
alter table public.fipe_uso enable row level security;
