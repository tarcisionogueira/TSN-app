-- 10/10 — json_pedir com Origin POR DESTINO. O gateway do Comprei (PGFN) responde 403 ao Origin da
-- Superbid e 200 ao próprio (https://comprei.pgfn.gov.br) — medido pelo pg_net. A coleta direta do
-- Comprei (scripts/scraper-comprei.mjs) cai nesta via quando o runner não alcança o gov.br.
-- Superbid continua o padrão (painel de comissão em api.s4bdigital.net, gerar-analise-veiculo).
create or replace function public.json_pedir(p_url text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'net'
as $function$
declare
  v_origem text := 'https://www.superbid.net';
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'json_pedir: só o servidor';
  end if;
  if p_url is null or p_url !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(/|\?|$)' then
    raise exception 'json_pedir: URL inválida (só https com domínio público)';
  end if;
  if p_url ~* '^https://([^/]*\.)?(localhost|internal|local|supabase\.co|supabase\.in)(:[0-9]+)?(/|\?|$)' then
    raise exception 'json_pedir: destino não permitido';
  end if;
  if p_url ~* '^https://comprei\.pgfn\.gov\.br(/|\?|$)' then
    v_origem := 'https://comprei.pgfn.gov.br';
  end if;
  return net.http_get(
    url := p_url,
    headers := jsonb_build_object(
      'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language', 'pt-BR,pt;q=0.9',
      'Accept', 'application/json',
      'Origin', v_origem,
      'Referer', v_origem || '/'),
    timeout_milliseconds := 25000);
end $function$;

revoke all on function public.json_pedir(text) from public, anon, authenticated;
grant execute on function public.json_pedir(text) to service_role;
