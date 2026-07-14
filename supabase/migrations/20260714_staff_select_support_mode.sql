-- Modo suporte (admin/analista "vendo como" o cliente): a equipe passa a LER os
-- dados do cliente nessas telas, espelhando o padrão já usado em analises_mercado
-- (am_select_staff). Permissivo por OR com a policy de dono — o cliente segue
-- lendo só o que é dele; sem estas policies o admin em modo suporte lê os PRÓPRIOS
-- dados (arremates não apareciam; filtros salvos eram os do admin).
create policy arrematados_select_staff on public.arrematados for select
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = any (array['admin','analista','consultor','advogado'])));

create policy arr_lanc_select_staff on public.arrematado_lancamentos for select
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = any (array['admin','analista','consultor','advogado'])));

create policy fs_select_staff on public.filtros_salvos for select
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = any (array['admin','analista','consultor','advogado'])));