-- POST DE FORMULÁRIO PELO BANCO (26/10). net.http_post só aceita Content-Type application/json; o pedido
-- de formulário entra direto na fila do pg_net (net.http_request_queue, mesmo INSERT que o http_post faz),
-- com o corpo x-www-form-urlencoded de verdade. Plataforma MSIS (21 leiloeiros do RJ): o catálogo inteiro só
-- vem por POST (Principal.asp acaoDest/pag) e parte dos tenants dá desafio do Cloudflare ao IP do GitHub.
-- Mesmas travas da pagina_postar_json (só service_role, só https público). Lido com pagina_ler(id).
-- Medido em 26/10: BSP acaoDest=N pag=2 pelo banco → 7 leilões diferentes da pág. 1 (o GET ?pag=2 devolve a pág. 1).
create or replace function public.pagina_postar_form(p_url text, p_campos jsonb)
returns bigint language plpgsql security definer set search_path to 'public','extensions','net' as $$
declare corpo text; origem text; rid bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres','supabase_admin') then
    raise exception 'pagina_postar_form: só o coletor (service_role)';
  end if;
  if p_url is null or p_url !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(/|\?|$)' then
    raise exception 'pagina_postar_form: URL inválida (só https com domínio público)';
  end if;
  if p_url ~* '^https://([^/]*\.)?(localhost|internal|local|supabase\.co|supabase\.in)(:[0-9]+)?(/|\?|$)' then
    raise exception 'pagina_postar_form: destino não permitido';
  end if;
  select coalesce(string_agg(net._urlencode_string(key) || '=' || net._urlencode_string(value), '&'), '')
    into corpo from jsonb_each_text(coalesce(p_campos, '{}'::jsonb));
  origem := substring(p_url from '^(https://[^/?]+)');
  insert into net.http_request_queue(method, url, headers, body, timeout_milliseconds)
  values ('POST', p_url,
          jsonb_build_object('Content-Type', 'application/x-www-form-urlencoded', 'Origin', origem, 'Referer', origem || '/'),
          convert_to(corpo, 'UTF8'), 25000)
  returning id into rid;
  perform net.wake();
  return rid;
end $$;
revoke all on function public.pagina_postar_form(text, jsonb) from public, anon, authenticated;
grant execute on function public.pagina_postar_form(text, jsonb) to service_role;
