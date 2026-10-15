-- 15/10 — live_plataforma_numeros_atualizar dava 57014 no desativar-encerrados-cron (14/10, 3x).
-- O FILTER (where ativo) varria as ~81,7 mil linhas da tabela (inclusive inativas) por index scan
-- em idx_imoveis_leilao_fonte: 5,7 s medidos, acima de 8 s com carga. Com o WHERE ativo no lugar
-- do FILTER lê só os ~29 mil ativos: 0,12 s. Mesmo resultado (as 4 contagens já exigiam ativo).
create or replace function public.live_plataforma_numeros_atualizar()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'lotes',        count(*),
    'leiloeiros',   count(distinct fonte),
    'cidades',      count(distinct cidade),
    'com_desconto', count(*) filter (where desconto_percentual between 50 and 95)
  ) into v from public.imoveis_leilao where ativo;

  insert into public.plataforma_numeros_cache (id, dados, atualizado_em)
  values (true, v, now())
  on conflict (id) do update set dados = excluded.dados, atualizado_em = excluded.atualizado_em;

  return v || jsonb_build_object('atualizado_em', now());
end;
$function$;
