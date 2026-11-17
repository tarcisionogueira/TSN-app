-- Reabre os avisos à Homio que esgotaram as 10 tentativas do cron (17/11). Nasceu porque a URL foi
-- cadastrada antes de o endpoint deles existir (HTTP 404 da Vercel deles): a fila continua íntegra,
-- só para de ser tentada. Depois que o destino estiver no ar: select public.homio_leads_reabrir_avisos();
create or replace function public.homio_leads_reabrir_avisos()
returns integer
language sql
security invoker
set search_path = public
as $$
  with r as (
    update public.homio_leads set homio_aviso_tentativas = 0, atualizado_em = now()
     where cardinality(homio_aviso_pendente) > 0 and homio_aviso_tentativas > 0
    returning 1
  )
  select count(*)::int from r;
$$;
