-- MODO SUPORTE (03/09): minha_rede() só aceitava p_root vindo de admin (is_admin()), mas quem
-- entra em modo suporte também pode ser analista (podeImpersonar no cliente = admin OU analista).
-- Um analista em modo suporte via Jean caía no ramo "else v_root := v_uid", ou seja, via a
-- PRÓPRIA rede do analista em vez da de Jean. Alinha o gate com is_equipe() (admin/advogado/
-- analista), o mesmo padrão já usado no restante do modo suporte.
create or replace function public.minha_rede(p_root uuid default null::uuid)
 returns table(id uuid, parent_id uuid, nivel integer, nome text, cidade_uf text, parceiro boolean, n_indicados integer, telefone text, email text, plano text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_pode_ver_outro boolean := public.is_equipe();
  v_root uuid;
begin
  if v_uid is null then return; end if;
  if v_pode_ver_outro then v_root := coalesce(p_root, v_uid); else v_root := v_uid; end if;

  return query
  with recursive rede as (
    select p.id, p.indicado_por as parent_id, 0 as nivel
      from public.perfis p where p.id = v_root
    union all
    select f.id, f.indicado_por, r.nivel + 1
      from public.perfis f
      join rede r on f.indicado_por = r.id
      where r.nivel < 10
  )
  select r.id,
         case when r.nivel = 0 then null else r.parent_id end as parent_id,
         r.nivel,
         coalesce(nullif(trim(p.nome), ''), 'Sem nome') as nome,
         public.cidade_uf_publica(p.endereco) as cidade_uf,
         (p.parceiro_aceite_em is not null) as parceiro,
         (select count(*)::int from public.perfis c where c.indicado_por = r.id) as n_indicados,
         case when r.nivel = 1 then p.telefone::text else null end as telefone,
         case when r.nivel = 1 then (select u.email::text from auth.users u where u.id = r.id) else null end as email,
         case when r.nivel = 1 then p.role::text else null end as plano
    from rede r
    join public.perfis p on p.id = r.id
   order by r.nivel, nome;
end; $function$;
