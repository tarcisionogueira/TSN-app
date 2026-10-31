-- 31/10: a busca de imóveis lê `imoveis_leilao_mascarado` (lista explícita de colunas) — sem isto o filtro
-- "Aceita proposta" e o selo do card recebiam `valor_piso_proposta` indefinido. Acrescenta a coluna NO FIM
-- (create or replace view só aceita coluna nova no final; mantém grants e security_invoker=false).
-- Falha se o ponto de inserção não estiver lá exatamente uma vez.
do $mig$
declare
  d text := pg_get_viewdef('public.imoveis_leilao_mascarado'::regclass);
  ancora constant text := E'\n   FROM (imoveis_leilao i';
begin
  if position('valor_piso_proposta' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, ancora, ''))) / length(ancora) <> 1 then
    raise exception 'imoveis_leilao_mascarado: ponto de inserção não encontrado exatamente 1 vez';
  end if;
  execute 'create or replace view public.imoveis_leilao_mascarado with (security_invoker = false) as '
    || replace(rtrim(d, E'; \n'), ancora, E',\n    i.valor_piso_proposta' || ancora);
end
$mig$;
