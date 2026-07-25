-- Extrai SÓ "Cidade - UF" do endereço livre (descarta rua/número/bairro/CEP) — para não
-- vazar endereço completo na árvore de rede (LGPD). Endereços "Cidade - UF" passam direto;
-- endereços completos ("... · Cidade - UF · CEP ...") caem no segmento que casa " - UF".
create or replace function public.cidade_uf_publica(p_end text)
returns text language sql immutable as $$
  select coalesce(
    (select trim(seg) from unnest(string_to_array(coalesce(p_end,''), '·')) seg
       where seg ~ ' - [A-Z]{2}\s*$' order by length(seg) limit 1),
    case when coalesce(p_end,'') <> '' and p_end !~ '\d' and char_length(p_end) <= 40
         then trim(p_end) else null end
  );
$$;

-- REDE DO PARCEIRO (LGPD-safe). Devolve SÓ a sub-árvore do chamador (descendentes via
-- indicado_por), sem NENHUM dado de contato (telefone/e-mail/endereço completo nunca saem):
-- só nome, cidade/UF, se é parceiro e nº de indicados diretos. Não-admin fica TRAVADO na
-- própria raiz; admin pode passar p_root para ver a rede de qualquer parceiro (ou a própria).
create or replace function public.minha_rede(p_root uuid default null)
returns table(id uuid, parent_id uuid, nivel int, nome text, cidade_uf text, parceiro boolean, n_indicados int)
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
         (select count(*)::int from public.perfis c where c.indicado_por = r.id) as n_indicados
    from rede r
    join public.perfis p on p.id = r.id
   order by r.nivel, nome;
end; $$;

-- Só usuários autenticados chamam (o corpo já trava por auth.uid()/is_admin()).
revoke all on function public.minha_rede(uuid) from public, anon;
grant execute on function public.minha_rede(uuid) to authenticated;
revoke all on function public.cidade_uf_publica(text) from public, anon;
grant execute on function public.cidade_uf_publica(text) to authenticated;
