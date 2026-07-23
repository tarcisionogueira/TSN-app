-- Retenção — candidatos a aviso: EXCLUI contas internas (admin/analista).
--
-- Contexto: o HANDOFF (#192) registra que a função passou a ignorar contas internas
-- (o cron chegou a "nudar" o próprio dono, um admin com imóveis de teste). Esse conserto
-- foi aplicado direto no banco (SQL Editor) e NÃO estava no source — drift código×banco
-- numa rotina de NOTIFICAÇÃO sobre PII. Esta migração codifica a definição VIVA e correta,
-- para que um rebuild/re-apply não reintroduza o nudge às contas internas.
--
-- Idempotente: é exatamente a função em produção (create or replace com o mesmo corpo).
-- A exclusão vive nos dois CTEs: r2 (join em perfis com role not in (...)) e
-- r1 (where role not in (...)).

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
      (p.inadimplente_desde + interval '30 days')::timestamptz as apagar_em,
      coalesce(ar.titulo, '') as titulo
    from public.imovel_anexos a
    join public.arrematados ar on ar.imovel_id = a.imovel_id::text
    join public.perfis p on p.id = ar.user_id
    where a.storage_path is not null
      and p.inadimplente_desde is not null
      and coalesce(p.role,'') not in ('admin','analista')
    order by a.imovel_id, ar.created_at desc
  )
  select imovel_id, user_id, regra, apagar_em, titulo from r2
  union all
  select imovel_id, user_id, regra, apagar_em, titulo from r1
$function$;
