-- Reenvio retroativo dos avisos à Homio (17/11). Até aqui HOMIO_WEBHOOK_URL não existia, e o aviso
-- sem URL é PULADO sem entrar na fila (`avisarHomio` → pulado: 'sem_url'): os inscritos anteriores
-- nunca foram avisados e o cron não tinha o que reenviar. Esta função põe na fila o aviso que falta:
--   conta_criada   → só de quem AINDA NÃO ativou e com link válido (link para quem já ativou só
--                    dispararia um WhatsApp inútil); quem ativou já tem `conta_ativada` na fila.
--   ja_tinha_conta → todos que ainda não foram avisados.
-- Idempotente: não duplica evento na fila nem reenfileira o que já foi avisado. Zera as tentativas
-- de quem entra na fila, para o cron ter as 10 tentativas inteiras.
create or replace function public.homio_leads_enfileirar_retroativo()
returns table (situacao text, enfileirados integer)
language sql
security invoker
set search_path = public
as $$
  with alvo as (
    select h.id, h.situacao from public.homio_leads h
     where not (h.homio_avisado ? h.situacao)
       and not (h.situacao = any(h.homio_aviso_pendente))
       and (h.situacao = 'ja_tinha_conta'
            or (h.situacao = 'conta_criada' and h.ativado_em is null
                and (h.token_expira_em is null or h.token_expira_em > now())))
  ), mudou as (
    update public.homio_leads h set
      homio_aviso_pendente   = array_prepend(a.situacao, h.homio_aviso_pendente),
      homio_aviso_tentativas = 0,
      atualizado_em          = now()
    from alvo a where a.id = h.id
    returning h.situacao
  )
  select situacao, count(*)::int from mudou group by 1;
$$;
-- Sem REVOKE (fica com o dono): é security invoker, e anon/authenticated não escrevem em homio_leads
-- desde 20261115 — chamada por eles não altera nada. Mesmo desenho das outras funções homio_*.
