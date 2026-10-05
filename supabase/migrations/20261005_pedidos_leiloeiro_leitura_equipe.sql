-- Fila "equipe pede pelo WhatsApp" no Admin (05/10): a equipe de análise LÊ os pedidos ao
-- leiloeiro. Escrita continua só pelo servidor (service key).
create policy documental_pedidos_leiloeiro_select_equipe on public.documental_pedidos_leiloeiro
  for select to authenticated
  using (exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role in ('admin','analista','advogado')));
