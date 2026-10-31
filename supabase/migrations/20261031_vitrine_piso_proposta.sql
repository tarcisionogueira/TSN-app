-- 31/10: `VeiculoDetalhe.jsx` passou a pedir `valor_piso_proposta` (commit 98bcc1c2) e o visitante sem
-- plano lê de `veiculos_vitrine`, que tem lista explícita de colunas e não tinha a nova — coluna
-- inexistente no select = 400 do PostgREST = ficha do veículo quebrada para quem não é equipe.
-- (A forma nº 7 do CLAUDE.md na direção da VIEW: a tabela recebeu a coluna, a view que o cliente lê não.)
-- Acrescenta no fim (create or replace view só aceita coluna nova no final); mantém grants e
-- security_invoker=false. Falha se o ponto de inserção não estiver lá exatamente uma vez.
do $mig$
declare
  d text := pg_get_viewdef('public.veiculos_vitrine'::regclass);
  ancora constant text := E'\n   FROM veiculos_leilao v';
begin
  if position('valor_piso_proposta' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, ancora, ''))) / length(ancora) <> 1 then
    raise exception 'veiculos_vitrine: ponto de inserção não encontrado exatamente 1 vez';
  end if;
  execute 'create or replace view public.veiculos_vitrine with (security_invoker = false) as '
    || replace(rtrim(d, E'; \n'), ancora, E',\n    valor_piso_proposta' || ancora);
end
$mig$;
