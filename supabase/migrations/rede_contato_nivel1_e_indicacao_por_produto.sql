-- (A) Árvore: expõe CONTATO apenas do NÍVEL 1 (indicado direto = venda direta do parceiro-raiz).
-- Do nível 2 em diante NUNCA sai contato (é venda do downline, não do parceiro). Muda o tipo de
-- retorno → precisa DROP antes do CREATE.
drop function if exists public.minha_rede(uuid);
create or replace function public.minha_rede(p_root uuid default null)
returns table(id uuid, parent_id uuid, nivel int, nome text, cidade_uf text, parceiro boolean, n_indicados int, telefone text, email text)
language plpgsql security definer set search_path to 'public' as $$
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
         -- CONTATO só do NÍVEL 1 (indicado direto do parceiro-raiz). N2+ = null (LGPD).
         case when r.nivel = 1 then p.telefone else null end as telefone,
         case when r.nivel = 1 then (select u.email from auth.users u where u.id = r.id) else null end as email
    from rede r
    join public.perfis p on p.id = r.id
   order by r.nivel, nome;
end; $$;
revoke all on function public.minha_rede(uuid) from public, anon;
grant execute on function public.minha_rede(uuid) to authenticated;

-- (B) Indicação (venda direta) DIFERENCIADA por produto:
--  • assinatura (Investidor Pro) e produto (digitais em conta): N1 = 25% (atratividade).
--  • venda_direta (Assessoria/Leilão Club, alto ticket): N1 = 10% (reduzido, protege eficiência).
-- Bônus de equipe (N2..N6 = 4/3/2/2/1) mantido nos três. Roteado por plano em api/_webhook-core.js.
update public.comissao_regras set pct = case nivel when 1 then 25 when 2 then 4 when 3 then 3 when 4 then 2 when 5 then 2 when 6 then 1 else 0 end, ativo = true where tipo in ('assinatura','produto');
update public.comissao_regras set pct = case nivel when 1 then 10 when 2 then 4 when 3 then 3 when 4 then 2 when 5 then 2 when 6 then 1 else 0 end, ativo = true where tipo = 'venda_direta';
update public.rank_config set comissao_indicacao_pct = 25 where id = 1;
