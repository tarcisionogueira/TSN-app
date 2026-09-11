-- Migração RETROATIVA (11/09) — a função já existe em produção, criada direto no SQL Editor
-- sem passar por aqui. `verificar:schema` (CI diário) acusou "forma #7b" do CLAUDE.md: função
-- no banco sem migração no repo — recriar o banco do zero perderia esta função silenciosamente.
-- Corpo copiado de produção via pg_get_functiondef(), sem alterar comportamento nenhum.
create or replace function public.alertas_engajamento_lote(p_user_ids uuid[])
returns table(user_id uuid, enviados_recentes integer, abertos_recentes integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  select e.user_id, count(*)::int as enviados_recentes,
         count(*) filter (where e.aberto_em is not null)::int as abertos_recentes
  from (
    select el.user_id, el.aberto_em,
           row_number() over (partition by el.user_id order by el.enviado_em desc) as rn
    from emails_log el
    where el.tipo = 'oportunidades' and el.user_id = any(p_user_ids)
  ) e
  where e.rn <= 4
  group by e.user_id;
$function$;
