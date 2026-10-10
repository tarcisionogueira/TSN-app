-- 10/10 — irmã JSON de pagina_pedir. A API do painel de lances da Superbid (api.s4bdigital.net
-- /offerpanel/api/app-context) é a fonte da COMISSÃO por oferta (comissaoPercentual: 5, ou 0 nos
-- leilões "sem taxas e comissão") e das parcelas; responde 406 ao Accept text/html de pagina_pedir.
-- Mesmas travas de destino; só service_role (o gerador de relatório de veículo chama pelo servidor).
create or replace function public.json_pedir(p_url text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'net'
as $function$
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
  return net.http_get(
    url := p_url,
    headers := jsonb_build_object(
      'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language', 'pt-BR,pt;q=0.9',
      'Accept', 'application/json',
      'Origin', 'https://www.superbid.net',
      'Referer', 'https://www.superbid.net/'),
    timeout_milliseconds := 25000);
end $function$;

revoke all on function public.json_pedir(text) from public, anon, authenticated;
grant execute on function public.json_pedir(text) to service_role;
