-- Achado pela própria auditoria_seguranca() (22/09): a função criada hoje (SECURITY DEFINER,
-- faz UPDATE em imoveis_leilao) tinha EXECUTE liberado pra PUBLIC/anon/authenticated — mesmo
-- padrão de erro que outras funções deste tipo já corrigem explicitamente (ver
-- whatsapp_fila_grupo). Sem isso, qualquer usuário anônimo podia chamar a função e forçar
-- um UPDATE em massa em imoveis_leilao, contornando a RLS normal da tabela.
revoke all on function public.editais_djen_backfill_url_lote() from public, anon, authenticated;
grant execute on function public.editais_djen_backfill_url_lote() to service_role;
