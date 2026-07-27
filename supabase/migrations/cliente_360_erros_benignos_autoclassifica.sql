-- Cliente 360 — erros benignos não devem parecer PENDÊNCIA.
--
-- Contexto: a tabela erros_cliente alimenta a tag "erro" (perfil com resolvido=false)
-- no Cliente 360. O frontend (src/utils/reportarErro.js) JÁ parou de logar os erros de
-- chunk-stale pós-deploy (auto-recuperáveis: recarrega e resolve). Mas:
--   (a) sobraram erros ANTIGOS (pré-correção) marcados como abertos — a conta admin do
--       dono aparecia com "erro" só por causa de vite:preloadError de deploys passados;
--   (b) navegadores com o index.html/JS em CACHE VELHO ainda mandam esse ruído até
--       recarregarem, e também há ruído de WebView iOS (window.webkit.messageHandlers)
--       que nunca foi bug nosso.
--
-- Solução (só banco, reversível): tratar essas classes BENIGNAS como resolvido=true na
-- ORIGEM (registrar_erro_cliente) — continuam registradas para diagnóstico, mas não contam
-- como pendência — e fazer o backfill dos antigos. O chunk genuinamente PRESO
-- ("vite:preloadError PRESO", recarga bloqueada pelo anti-loop) NÃO é benigno: segue como
-- erro real (contém 'preso' → excluído do filtro).

-- 1) Ingestão passa a auto-classificar o ruído benigno como resolvido (mesma assinatura).
create or replace function public.registrar_erro_cliente(
  p_fingerprint text,
  p_msg text,
  p_rota text default null,
  p_url text default null,
  p_ua text default null,
  p_user_id uuid default null
) returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.erros_cliente (fingerprint, msg, rota, url, ua, user_id, resolvido)
  values (
    p_fingerprint, left(p_msg, 300), left(p_rota, 120), left(p_url, 300), left(p_ua, 300), p_user_id,
    -- BENIGNO (não é bug acionável): chunk-stale pós-deploy de cliente com cache velho +
    -- ruído de WebView/extension. Exclui o caso PRESO (chunk genuinamente travado = real).
    case when (
         (lower(coalesce(p_msg,'')) like '%vite:preloaderror%' and lower(coalesce(p_msg,'')) not like '%preso%')
      or lower(coalesce(p_msg,'')) like '%importing a module script failed%'
      or lower(coalesce(p_msg,'')) like '%failed to fetch dynamically imported module%'
      or lower(coalesce(p_msg,'')) like '%error loading dynamically imported module%'
      or lower(coalesce(p_msg,'')) like '%chunk stale%'
      or lower(coalesce(p_msg,'')) like '%webkit.messagehandlers%'
    ) then true else false end
  )
  on conflict (fingerprint) do update
    set ocorrencias = public.erros_cliente.ocorrencias + 1,
        ultima_em   = now(),
        msg         = excluded.msg,
        rota        = excluded.rota,
        url         = excluded.url,
        user_id     = coalesce(excluded.user_id, public.erros_cliente.user_id);
        -- resolvido NÃO é reaberto no conflito: um benigno já classificado (ou um erro
        -- que o admin marcou resolvido) continua fora da fila de pendência.
$function$;

-- 2) Backfill dos ANTIGOS benignos ainda abertos (chunk-stale/derivados + WebView iOS).
--    Inclui os erros DERIVADOS de chunk velho ("reading 'default'", destructure de
--    'default'/'logUso', "(destructured parameter) is undefined") — todos comprovadamente
--    do período pré-correção e hoje suprimidos na origem pelo reportarErro.js.
update public.erros_cliente
   set resolvido = true
 where resolvido = false
   and (
        (lower(msg) like '%vite:preloaderror%' and lower(msg) not like '%preso%')
     or lower(msg) like '%importing a module script failed%'
     or lower(msg) like '%module script failed%'
     or lower(msg) like '%failed to fetch dynamically imported module%'
     or lower(msg) like '%error loading dynamically imported module%'
     or lower(msg) like '%chunk stale%'
     or lower(msg) like '%webkit.messagehandlers%'
     or lower(msg) like '%reading ''default''%'
     or lower(msg) like '%destructure property ''default''%'
     or lower(msg) like '%destructure property ''loguso''%'
     or lower(msg) like '%(destructured parameter) is undefined%'
   );
