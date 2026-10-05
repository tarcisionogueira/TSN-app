-- POST JSON PELO SERVIDOR DO BANCO (pg_net) — 05/10/2026 (#41, plataforma Astavero)
-- Gêmeo de `pagina_pedir` (20260929_pagina_pelo_banco.sql) para APIs que só respondem a POST com corpo
-- JSON (`/app/lotes`, `/app/pregao/init`). Mesmas travas: só https com domínio público, nada interno,
-- executável só pela service_role (senão vira proxy aberto com o IP do banco). Resposta: `pagina_ler`.
create or replace function public.pagina_postar_json(p_url text, p_corpo jsonb)
returns bigint language plpgsql security definer set search_path = public, extensions, net as $$
declare origem text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'pagina_postar_json: só o coletor (service_role)';
  end if;
  if p_url is null or p_url !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(/|\?|$)' then
    raise exception 'pagina_postar_json: URL inválida (só https com domínio público)';
  end if;
  if p_url ~* '^https://([^/]*\.)?(localhost|internal|local|supabase\.co|supabase\.in)(:[0-9]+)?(/|\?|$)' then
    raise exception 'pagina_postar_json: destino não permitido';
  end if;
  origem := substring(p_url from '^(https://[^/?]+)');
  return net.http_post(
    url := p_url,
    body := coalesce(p_corpo, '{}'::jsonb),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Accept', 'application/json, text/plain, */*',
      'Origin', origem, 'Referer', origem || '/',
      'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'),
    timeout_milliseconds := 25000);
end $$;

revoke all on function public.pagina_postar_json(text, jsonb) from public, anon, authenticated;
grant execute on function public.pagina_postar_json(text, jsonb) to service_role;
