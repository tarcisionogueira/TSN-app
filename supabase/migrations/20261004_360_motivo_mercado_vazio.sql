-- 04/10: o Cliente 360 rotulava TODO `relatorio_mercado_vazio` como "sem comparáveis". O caso real
-- (Santo Amaro, LEILAOBRASIL) tinha 11 comparáveis do mesmo condomínio; faltava a ÁREA do imóvel.
-- O motivo mandava investigar a busca, que estava sã (forma nº 10). `meta.comparaveis` já é gravado
-- pelo gerador; o rótulo passa a distinguir. Aplicada por troca de trecho para não divergir do corpo
-- vigente (a função tem várias versões no histórico — ver regra 7b do CLAUDE.md).
do $$
declare d text; antigo text := $a$when evento = 'relatorio_mercado_vazio' then 'sem comparáveis'$a$;
begin
  d := pg_get_functiondef('public.admin_360_estatisticas'::regproc);
  if strpos(d, antigo) = 0 then return; end if; -- já aplicada
  d := replace(d, antigo, $n$when evento = 'relatorio_mercado_vazio' and coalesce((meta->>'comparaveis')::int, 0) > 0 then 'comparáveis achados, sem área do imóvel'
                 when evento = 'relatorio_mercado_vazio' then 'sem comparáveis'$n$);
  execute d;
end $$;
