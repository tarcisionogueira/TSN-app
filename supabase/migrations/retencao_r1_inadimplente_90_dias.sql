-- RETENÇÃO — Regra 1 (arrematado + inadimplente): 30 → 90 dias após parar de pagar.
--
-- 18/09, pedido do dono, ao investigar o caso do Marcos: documentos de uma arrematação REAL
-- (matrícula, edital, etc.) devem ficar guardados "enquanto ele for pagante"; a janela depois
-- de deixar de pagar era 30 dias (retencao_etapa2_sinalizacao_avisos.sql, 22/07) — o dono pediu
-- 90 dias, mesmo padrão já usado em outras janelas do sistema (fotos expiradas, análises
-- órfãs). Muda só o NÚMERO; o desenho notify-first (avisa antes, só apaga com aviso enviado +
-- carência vencida, revalida no momento da deleção) continua intacto.
--
-- Duas funções mexem no mesmo número e as duas precisam mudar juntas, senão o aviso promete
-- uma data e a deleção revalida outra:
--   1) retencao_candidatos_aviso() — calcula apagar_em = inadimplente_desde + 90 dias (era a
--      versão de retencao_candidatos_aviso_exclui_internos.sql, preservada aqui inteira).
--   2) anexos_expirados_avisados() — revalida, no momento de apagar de fato, que a
--      inadimplência já passou de 90 dias (era 30).

CREATE OR REPLACE FUNCTION public.retencao_candidatos_aviso()
 RETURNS TABLE(imovel_id uuid, user_id uuid, regra text, apagar_em timestamp with time zone, titulo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  with docs as (
    select distinct a.imovel_id
    from public.imovel_anexos a
    where a.storage_path is not null and a.arrematado = false
  ),
  rel as (
    select imovel_id as iid, user_id, titulo, created_at from public.analises_mercado
    union all
    select imovel_id, user_id, titulo, created_at from public.analises_documental
    union all
    select imovel_id, user_id, titulo, created_at from public.analises_laudo
  ),
  completos as (
    select d.imovel_id
    from docs d
    where exists (select 1 from public.analises_mercado    m where m.imovel_id = d.imovel_id::text)
      and exists (select 1 from public.analises_documental x where x.imovel_id = d.imovel_id::text)
      and exists (select 1 from public.analises_laudo      l where l.imovel_id = d.imovel_id::text)
      and not exists (select 1 from public.arrematados ar where ar.imovel_id = d.imovel_id::text)
  ),
  r2 as (
    select distinct on (c.imovel_id)
      c.imovel_id,
      r.user_id,
      'r2_sem_arremate'::text as regra,
      (max(r.created_at) over (partition by c.imovel_id)) + interval '15 days' as apagar_em,
      r.titulo
    from completos c
    join rel r on r.iid = c.imovel_id::text
    join public.perfis pu on pu.id = r.user_id and coalesce(pu.role,'') not in ('admin','analista')
    order by c.imovel_id, r.created_at desc
  ),
  r1 as (
    select distinct on (a.imovel_id)
      a.imovel_id,
      ar.user_id,
      'r1_inadimplente'::text as regra,
      (p.inadimplente_desde + interval '90 days')::timestamptz as apagar_em,
      coalesce(ar.titulo, '') as titulo
    from public.imovel_anexos a
    join public.arrematados ar on ar.imovel_id = a.imovel_id::text
    join public.perfis p on p.id = ar.user_id and coalesce(p.role,'') not in ('admin','analista')
    where a.storage_path is not null
      and p.inadimplente_desde is not null
    order by a.imovel_id, ar.created_at desc
  )
  select imovel_id, user_id, regra, apagar_em, titulo from r2
  union all
  select imovel_id, user_id, regra, apagar_em, titulo from r1
$function$;

CREATE OR REPLACE FUNCTION public.anexos_expirados_avisados(p_limite integer DEFAULT 100)
 RETURNS TABLE(id uuid, storage_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  select a.id, a.storage_path
  from public.imovel_anexos a
  join public.doc_retencao_aviso v on v.imovel_id = a.imovel_id
  where a.storage_path is not null
    and v.cancelado_em is null
    and v.email_enviado = true          -- NOTIFY-FIRST: nunca apaga sem aviso enviado
    and v.apagar_em <= now()            -- carência pós-aviso cumprida
    and (
      (v.regra = 'r1_inadimplente'
        and exists (
          select 1 from public.arrematados ar
          join public.perfis p on p.id = ar.user_id
          where ar.imovel_id = a.imovel_id::text
            and p.inadimplente_desde is not null
            and p.inadimplente_desde + interval '90 days' <= now()
        ))
      or
      (v.regra = 'r2_sem_arremate'
        and a.arrematado = false
        and not exists (select 1 from public.arrematados ar where ar.imovel_id = a.imovel_id::text)
        and exists (select 1 from public.analises_mercado    m where m.imovel_id = a.imovel_id::text)
        and exists (select 1 from public.analises_documental d where d.imovel_id = a.imovel_id::text)
        and exists (select 1 from public.analises_laudo      l where l.imovel_id = a.imovel_id::text)
      )
    )
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$function$;

revoke execute on function public.retencao_candidatos_aviso() from public, anon, authenticated;
revoke execute on function public.anexos_expirados_avisados(integer) from public, anon, authenticated;
