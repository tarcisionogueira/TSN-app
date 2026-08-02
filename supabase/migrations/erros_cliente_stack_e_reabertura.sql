-- Fecha o ciclo "registrar → resolver → se voltar, avisar" dos erros de runtime do cliente.
-- Duas lacunas achadas em 02/08 investigando o crash de 30/07 na /analise:
--
-- 1) STACK DESCARTADO NO ÚLTIMO METRO. `src/utils/reportarErro.js` SEMPRE enviou a pilha e
--    `api/log-erro-cliente.js` SEMPRE a recebeu — mas a RPC não tinha o parâmetro e a coluna
--    não existia. Por isso o "Maximum call stack size exceeded" chegou sem nenhuma pista de
--    onde estourou (era o upload de matrícula: `String.fromCharCode(...bytes)` em PDF de MBs).
--
-- 2) REINCIDÊNCIA NÃO REABRIA. O ON CONFLICT somava `ocorrencias` e atualizava `ultima_em`,
--    mas NUNCA tocava `resolvido`. Como o Cliente 360 tem o botão "✓ Marcar como resolvidos" e
--    o health-check só lê `resolvido=false`, um erro fechado que voltasse a acontecer ficava
--    invisível PARA SEMPRE: contador subindo em silêncio e a tela verde escrito "resolvido".
--    Provado antes da correção: 2 ocorrências com resolvido=true.
--    Agora a reincidência REABRE — menos a classe auto-resolvida (chunk stale pós-deploy e
--    afins), que se recupera sozinha e viraria ruído diário.
alter table public.erros_cliente add column if not exists stack text;

create or replace function public.registrar_erro_cliente(
  p_fingerprint text, p_msg text, p_rota text default null::text, p_url text default null::text,
  p_ua text default null::text, p_user_id uuid default null::uuid, p_stack text default null::text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.erros_cliente (fingerprint, msg, rota, url, ua, user_id, stack, resolvido)
  values (
    p_fingerprint, left(p_msg, 300), left(p_rota, 120), left(p_url, 300), left(p_ua, 300), p_user_id,
    left(p_stack, 4000),
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
        -- pilha da 1ª ocorrência não se perde quando a próxima vier sem stack
        stack       = coalesce(excluded.stack, public.erros_cliente.stack),
        user_id     = coalesce(excluded.user_id, public.erros_cliente.user_id),
        -- REABRE (o `excluded.resolvido` recalcula a regra: só a classe auto-resolvida fica true)
        resolvido   = excluded.resolvido;
$function$;

comment on column public.erros_cliente.stack is
  'Pilha do erro no cliente. O front sempre enviou; até 02/08 era descartada na RPC.';
comment on function public.registrar_erro_cliente(text,text,text,text,text,uuid,text) is
  'Registra erro de runtime do cliente. Dedup por fingerprint (msg+rota). A REINCIDENCIA REABRE o erro (resolvido volta a false) para health-check e Cliente 360 voltarem a mostrar — exceto a classe auto-resolvida (chunk stale pos-deploy).';
