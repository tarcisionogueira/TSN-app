-- 04/10 — Retenção R2: "os 3 relatórios concluídos" passa a exigir o MESMO usuário,
-- e o imóvel com mais de um cliente fica FORA da apagação automática.
--
-- O DEFEITO (varredura de 04/10, latente — dry-run de hoje: 0 candidatos antes e depois):
--   `completos` perguntava "existe mercadológico? existe documental? existe laudo?" sobre o
--   IMÓVEL, sem olhar quem gerou. Mercadológico do cliente A + documental do B + laudo do C
--   virava "imóvel concluído", e o aviso "Você concluiu os 3 relatórios" ia só para quem gerou
--   por último (distinct on imovel_id ... order by created_at desc). Como a trava é
--   unique(imovel_id, regra) em doc_retencao_aviso e `anexos_expirados_avisados` apaga POR
--   IMÓVEL assim que existe UM aviso enviado, A e B perdiam os documentos sem nunca terem sido
--   avisados — o contrário do NOTIFY-FIRST que a etapa 2 prometeu.
--
-- A OPÇÃO ESCOLHIDA (a que menos mexe no contrato):
--   Avisar todos exigiria um aviso por (imóvel, usuário): trocar o unique da tabela, o dedup do
--   cron (que procura por imovel_id+regra) e a regra de deleção ("só apaga quando TODOS os avisos
--   do imóvel foram enviados"). Três peças para um caso que hoje não tem nenhuma ocorrência.
--   Em vez disso, o R2 só considera o imóvel quando há EXATAMENTE UM cliente (não-interno) com
--   relatório dele, e é esse mesmo cliente quem tem os 3. Assim "um imóvel = um aviso = um dono"
--   volta a ser verdade, e o RPC continua devolvendo uma linha por (imovel_id, regra) com as
--   mesmas colunas — o api/retencao-avisos-cron.js não muda.
--   Custo aceito: imóvel com 2+ clientes não libera storage pelo R2 (fica retido). Retenção a
--   mais é reversível; documento apagado sem aviso não é.
--   Relatório de admin/analista não conta nem para "completar" nem como "outro cliente"
--   (já era excluído do aviso desde retencao_candidatos_aviso_exclui_internos.sql).
--
-- A DELEÇÃO TAMBÉM: `anexos_expirados_avisados` repetia o mesmo critério por imóvel no ramo R2.
--   Sem corrigi-la, um aviso já gravado continuaria apagando se um 2º cliente gerasse relatório
--   DEPOIS do aviso. Agora ela reconfere, na hora de apagar, que o imóvel segue com um único
--   cliente, que é o avisado (v.user_id), e que ele tem os 3.
--
-- R1 (inadimplente) e o resto dos dois corpos ficam idênticos ao vigente no banco em 04/10
-- (lido por pg_get_functiondef, não do repo).

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
  -- relatórios de CLIENTES (contas internas não completam nem contam como outro dono)
  rel as (
    select r.iid, r.user_id, r.tipo, r.titulo, r.created_at
    from (
      select imovel_id as iid, user_id, 'mercado'::text as tipo, titulo, created_at from public.analises_mercado
      union all
      select imovel_id, user_id, 'documental', titulo, created_at from public.analises_documental
      union all
      select imovel_id, user_id, 'laudo', titulo, created_at from public.analises_laudo
    ) r
    join public.perfis pu on pu.id = r.user_id and coalesce(pu.role,'') not in ('admin','analista')
  ),
  por_usuario as (
    select iid, user_id, count(distinct tipo) as tipos
    from rel group by iid, user_id
  ),
  -- 04/10: os 3 relatórios do MESMO usuário, e ele é o ÚNICO cliente com relatório do imóvel
  completos as (
    select d.imovel_id, pu.user_id
    from docs d
    join por_usuario pu on pu.iid = d.imovel_id::text and pu.tipos = 3
    where not exists (select 1 from por_usuario o
                       where o.iid = pu.iid and o.user_id <> pu.user_id)
      and not exists (select 1 from public.arrematados ar where ar.imovel_id = d.imovel_id::text)
  ),
  r2 as (
    select distinct on (c.imovel_id)
      c.imovel_id,
      c.user_id,
      'r2_sem_arremate'::text as regra,
      (max(r.created_at) over (partition by c.imovel_id)) + interval '15 days' as apagar_em,
      r.titulo
    from completos c
    join rel r on r.iid = c.imovel_id::text and r.user_id = c.user_id
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
        -- 04/10: os 3 relatórios são do usuário AVISADO...
        and exists (select 1 from public.analises_mercado    m where m.imovel_id = a.imovel_id::text and m.user_id = v.user_id)
        and exists (select 1 from public.analises_documental d where d.imovel_id = a.imovel_id::text and d.user_id = v.user_id)
        and exists (select 1 from public.analises_laudo      l where l.imovel_id = a.imovel_id::text and l.user_id = v.user_id)
        -- ...e nenhum OUTRO cliente gerou relatório do imóvel (ele não foi avisado)
        and not exists (
          select 1
          from (
            select user_id from public.analises_mercado    where imovel_id = a.imovel_id::text
            union
            select user_id from public.analises_documental where imovel_id = a.imovel_id::text
            union
            select user_id from public.analises_laudo      where imovel_id = a.imovel_id::text
          ) o
          join public.perfis po on po.id = o.user_id and coalesce(po.role,'') not in ('admin','analista')
          where o.user_id is distinct from v.user_id
        )
      )
    )
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$function$;

revoke execute on function public.retencao_candidatos_aviso() from public, anon, authenticated;
revoke execute on function public.anexos_expirados_avisados(integer) from public, anon, authenticated;
