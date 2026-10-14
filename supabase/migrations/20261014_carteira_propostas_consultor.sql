-- Carteira de propostas liberada para ANALISTA e CONSULTOR (14/10, dono). `is_equipe()` não inclui
-- consultor e é usada em RLS por toda a base — não se mexe nela por isto. O gate desta função passa
-- a ser a mesma lista do servidor para relatório pós-leilão (ROLES_EQUIPE_RELATORIO em
-- api/_leilao-encerrado.js): admin, analista, advogado, suporte, consultor.
do $mig$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.oportunidades_proposta(integer, text)'::regprocedure);
  v_novo := replace(v_def, 'and public.is_equipe()',
    $$and exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','analista','advogado','suporte','consultor'))$$);
  if v_novo = v_def then raise exception 'oportunidades_proposta: gate is_equipe() não encontrado'; end if;
  execute v_novo;
end
$mig$;
