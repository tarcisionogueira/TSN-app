-- 23/10 (página inicial nova): os números de prova do topo (imóveis e veículos monitorados, leiloeiros)
-- vêm do acervo, nunca escritos à mão — um "31 mil" fixo vira mentira em duas semanas. Contar ao vivo
-- custa ~9 s (45 mil linhas), então o número é CALCULADO 1x/dia (monitor-fontes-cron) e guardado em
-- app_config; a página só lê (landing_numeros, anon). Só agregados — nenhum dado de lote sai daqui.
create or replace function public.landing_numeros_atualizar()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'imoveis', (select count(*) from imoveis_leilao where ativo),
    'veiculos', (select count(*) from veiculos_leilao where ativo),
    'leiloeiros', (select count(distinct lower(trim(l))) from (
        select leiloeiro l from imoveis_leilao where ativo
        union all select leiloeiro from veiculos_leilao where ativo) x where l is not null and trim(l) <> ''),
    'em', now())
    into v;
  insert into app_config (key, value, updated_at) values ('landing_numeros', v::text, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $function$;

create or replace function public.landing_numeros()
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select value::jsonb from app_config where key = 'landing_numeros'), '{}'::jsonb);
$function$;

revoke execute on function public.landing_numeros_atualizar() from public, anon, authenticated;
grant execute on function public.landing_numeros_atualizar() to service_role;
revoke execute on function public.landing_numeros() from public;
grant execute on function public.landing_numeros() to anon, authenticated, service_role;
