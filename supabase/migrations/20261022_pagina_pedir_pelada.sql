-- 22/10 (#292): servidores IIS (Baston, Nova Serrana, PW, Milan) respondem 400 a QUALQUER User-Agent e só abrem com
-- o pedido "pelado". `pagina_pedir` manda UA de navegador — então a via grátis pelo banco (viaBanco) também via 400.
-- Variante sem cabeçalho, mesmas travas de destino; só o servidor (service_role) chama.
create or replace function public.pagina_pedir_pelada(p_url text)
 returns bigint language plpgsql security definer set search_path to 'public', 'extensions', 'net' as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'pagina_pedir_pelada: só o servidor';
  end if;
  if p_url is null or p_url !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(/|\?|$)' then
    raise exception 'pagina_pedir_pelada: URL inválida (só https com domínio público)';
  end if;
  if p_url ~* '^https://([^/]*\.)?(localhost|internal|local|supabase\.co|supabase\.in)(:[0-9]+)?(/|\?|$)' then
    raise exception 'pagina_pedir_pelada: destino não permitido';
  end if;
  return net.http_get(url := p_url, headers := '{}'::jsonb, timeout_milliseconds := 25000);
end $function$;

revoke execute on function public.pagina_pedir_pelada(text) from public, anon, authenticated;
grant execute on function public.pagina_pedir_pelada(text) to service_role;
