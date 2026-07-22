-- ─────────────────────────────────────────────────────────────────────────────
-- RETENÇÃO — ETAPA 2 (sinalização de arremate + avisos "notify-first")
-- Regras do dono (22/07) que a Etapa 1 deixou PENDENTES por exigirem notificação:
--   • REGRA 1 (arrematado): mantém enquanto o dono paga. Se PARAR de pagar
--     (perfis.inadimplente_desde), avisa e só apaga 30 dias depois.
--   • REGRA 2 (não arrematado + os 3 relatórios completos): mantém 15 dias; avisa
--     que o cliente precisa SINALIZAR o arremate (vira Regra 1). Se não sinalizar
--     em 15 dias, os documentos ficam elegíveis para limpeza.
--
-- TRAVA DE SEGURANÇA (regra absoluta do dono: "notificar ANTES de apagar"):
--   nada entra na lista de deleção sem: (a) um aviso GRAVADO com email_enviado=true
--   e (b) a carência (apagar_em) já vencida. A RPC de deleção revalida o estado
--   atual, então se o cliente regularizar o pagamento OU sinalizar o arremate, o
--   documento sai da fila automaticamente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Registro de avisos enviados (uma linha por imóvel+regra). Sem policies →
--    só o service_role (cron) acessa; RLS ligado satisfaz o auditor de segurança.
create table if not exists public.doc_retencao_aviso (
  id            uuid primary key default gen_random_uuid(),
  imovel_id     uuid not null,                 -- = imovel_anexos.imovel_id / imoveis_leilao.id
  user_id       uuid,                          -- destinatário do aviso (dono dos relatórios / arrematante)
  regra         text not null check (regra in ('r1_inadimplente','r2_sem_arremate')),
  motivo        text,
  avisado_em    timestamptz not null default now(),
  apagar_em     timestamptz not null,          -- só apaga a partir daqui (carência pós-aviso)
  email_enviado boolean not null default false,
  push_enviado  boolean not null default false,
  cancelado_em  timestamptz,                   -- regularizou/sinalizou → cancelado (não apaga)
  unique (imovel_id, regra)
);
alter table public.doc_retencao_aviso enable row level security;
comment on table public.doc_retencao_aviso is
  'Retenção Etapa 2: avisos enviados antes de apagar documentos (notify-first). Só service_role acessa.';

-- 2) Candidatos a AVISO — o cron retencao-avisos-cron lê daqui e dispara e-mail/push.
--    NÃO apaga nada; apenas identifica quem deve ser avisado e a data-limite (apagar_em).
create or replace function public.retencao_candidatos_aviso()
 returns table(imovel_id uuid, user_id uuid, regra text, apagar_em timestamptz, titulo text)
 language sql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
  with docs as (  -- imóveis com documentos AINDA armazenados e não sinalizados como arrematados
    select distinct a.imovel_id
    from public.imovel_anexos a
    where a.storage_path is not null and a.arrematado = false
  ),
  rel as (        -- reunião das 3 análises (imovel_id é TEXT nas análises)
    select imovel_id as iid, user_id, titulo, created_at from public.analises_mercado
    union all
    select imovel_id, user_id, titulo, created_at from public.analises_documental
    union all
    select imovel_id, user_id, titulo, created_at from public.analises_laudo
  ),
  completos as ( -- imóveis (com docs) que têm os 3 tipos e NÃO foram sinalizados como arrematados
    select d.imovel_id
    from docs d
    where exists (select 1 from public.analises_mercado    m where m.imovel_id = d.imovel_id::text)
      and exists (select 1 from public.analises_documental x where x.imovel_id = d.imovel_id::text)
      and exists (select 1 from public.analises_laudo      l where l.imovel_id = d.imovel_id::text)
      and not exists (select 1 from public.arrematados ar where ar.imovel_id = d.imovel_id::text)
  ),
  r2 as (        -- REGRA 2: 15 dias após o 3º relatório
    select distinct on (c.imovel_id)
      c.imovel_id,
      r.user_id,
      'r2_sem_arremate'::text as regra,
      (max(r.created_at) over (partition by c.imovel_id)) + interval '15 days' as apagar_em,
      r.titulo
    from completos c
    join rel r on r.iid = c.imovel_id::text
    order by c.imovel_id, r.created_at desc
  ),
  r1 as (        -- REGRA 1: arrematado sinalizado + dono inadimplente → 30 dias após parar de pagar
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
    order by a.imovel_id, ar.created_at desc
  )
  select imovel_id, user_id, regra, apagar_em, titulo from r2
  union all
  select imovel_id, user_id, regra, apagar_em, titulo from r1
$function$;

-- 3) Documentos ELEGÍVEIS À DELEÇÃO — só o que já foi avisado e cuja carência venceu.
--    Revalida o estado atual (inadimplência/arremate/relatórios) para nunca apagar
--    algo que "esfriou" mas foi regularizado depois do aviso.
create or replace function public.anexos_expirados_avisados(p_limite integer DEFAULT 100)
 returns table(id uuid, storage_path text)
 language sql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
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
            and p.inadimplente_desde + interval '30 days' <= now()
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

-- Só o service_role (cron) executa estas RPCs. Revoga de PUBLIC (grant padrão de
-- função) além de anon/authenticated — senão o auditor acusa SECURITY DEFINER exposta.
revoke execute on function public.retencao_candidatos_aviso() from public, anon, authenticated;
revoke execute on function public.anexos_expirados_avisados(integer) from public, anon, authenticated;
