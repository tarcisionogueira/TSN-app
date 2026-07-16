-- Corrige "new row violates row-level security policy for table casos".
--
-- Sintoma: o cliente (investidor) clica em "tenho interesse" num imóvel, o front
-- cria o caso via insert client-side (src/pages/Caso.jsx → supabase.from('casos')
-- .insert({ cliente_id: user.id, ... })) e o RLS bloqueia — a tela mostra o erro
-- cru e depois o boundary "Algo deu errado".
--
-- Causa: a tabela `casos` tinha só políticas de SELECT (cliente/analista/advogado)
-- e ALL para admin. Faltava a política de INSERT do cliente (o padrão do projeto:
-- solicitacoes/agendamentos/relatorios usam `for insert with check (auth.uid() = user_id)`).
-- Sem ela, apenas admin (via casos_admin_all) conseguia inserir.
--
-- Fix: permite o usuário autenticado criar o PRÓPRIO caso (cliente_id = seu uid).
-- Não permite criar caso para terceiros (o WITH CHECK trava cliente_id).
drop policy if exists casos_cliente_insert on public.casos;
create policy casos_cliente_insert on public.casos
  for insert to public
  with check ((select auth.uid()) = cliente_id);
