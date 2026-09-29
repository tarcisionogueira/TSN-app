-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PÁGINA BUSCADA PELO SERVIDOR DO BANCO (pg_net) — 29/09/2026
--
-- Achado: UBERLANDIALEILOES responde 403 ao runner do GitHub (Azure) E ao PC do dono, e 200 ao
-- servidor do banco (AWS) — medido no mesmo dia, 14 leilões na home. O mesmo vale para parte dos
-- sites que barravam a captura de e-mail. Os coletores do motor só tinham duas vias: fetch direto
-- (grátis) e Bright Data (pago). Esta é a terceira, grátis, entre as duas.
--
-- Dois passos porque o pg_net só dispara a requisição DEPOIS do commit: esperar a resposta na
-- mesma transação que a pediu nunca termina. `pagina_pedir` devolve o id; `pagina_ler` devolve a
-- resposta quando o worker a gravou (pronto=false enquanto não).
--
-- Segurança: SECURITY DEFINER executável SÓ pela service_role (o coletor). Nada de anon/
-- authenticated — seria um proxy aberto (SSRF) com o IP do banco. Só https, sem host interno.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.pagina_pedir(p_url text)
returns bigint language plpgsql security definer set search_path = public, extensions, net as $$
begin
  if p_url is null or p_url !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(/|\?|$)' then
    raise exception 'pagina_pedir: URL inválida (só https com domínio público)';
  end if;
  if p_url ~* '^https://([^/]*\.)?(localhost|internal|local|supabase\.co|supabase\.in)(:[0-9]+)?(/|\?|$)' then
    raise exception 'pagina_pedir: destino não permitido';
  end if;
  return net.http_get(
    url := p_url,
    headers := jsonb_build_object(
      'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language', 'pt-BR,pt;q=0.9',
      'Accept', 'text/html,application/xhtml+xml'),
    timeout_milliseconds := 25000);
end $$;

create or replace function public.pagina_ler(p_id bigint)
returns table(pronto boolean, status integer, conteudo text, erro text)
language sql stable security definer set search_path = public, net as $$
  select true, r.status_code, r.content, r.error_msg from net._http_response r where r.id = p_id
  union all
  select false, null, null, null where not exists (select 1 from net._http_response r where r.id = p_id)
$$;

revoke all on function public.pagina_pedir(text) from public, anon, authenticated;
revoke all on function public.pagina_ler(bigint) from public, anon, authenticated;
grant execute on function public.pagina_pedir(text) to service_role;
grant execute on function public.pagina_ler(bigint) to service_role;
