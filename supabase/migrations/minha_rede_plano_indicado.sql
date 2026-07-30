-- Minha Rede: expõe o PLANO do indicado DIRETO (pedido do dono 30/07 — "identificar se é
-- grátis, Investidor Pro, assessorado, Leilão Club"). Mesma régua LGPD do contato: plano
-- SÓ no nível 1 (venda direta do parceiro-raiz); a rede abaixo segue só nome+cidade.
-- Mudança de tipo de retorno exige DROP + CREATE (re-grant explícito abaixo).
drop function if exists public.minha_rede(uuid);

CREATE OR REPLACE FUNCTION public.minha_rede(p_root uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, parent_id uuid, nivel integer, nome text, cidade_uf text, parceiro boolean, n_indicados integer, telefone text, email text, plano text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_root uuid;
begin
  if v_uid is null then return; end if;
  if v_is_admin then v_root := coalesce(p_root, v_uid); else v_root := v_uid; end if;

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
         -- CONTATO e PLANO só do NÍVEL 1 (indicado direto do parceiro-raiz). N2+ = null (LGPD).
         case when r.nivel = 1 then p.telefone::text else null end as telefone,
         case when r.nivel = 1 then (select u.email::text from auth.users u where u.id = r.id) else null end as email,
         case when r.nivel = 1 then p.role::text else null end as plano
    from rede r
    join public.perfis p on p.id = r.id
   order by r.nivel, nome;
end; $function$;

grant execute on function public.minha_rede(uuid) to authenticated;
grant execute on function public.minha_rede(uuid) to service_role;
