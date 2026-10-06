-- O CLIENTE NÃO APAGA O QUE A EQUIPE REGISTROU (06/10, decisão do dono: "esconda o × quando a equipe
-- registrar algo; o cliente não pode apagar os registros feitos"). Amplia 20261006_arremate_protege_andamento:
--   • andamento do processo (caso_andamentos)  → ninguém apaga o arremate (o cascade levaria o diário);
--   • documento anexado pela EQUIPE ao imóvel   → o CLIENTE não apaga o arremate (a equipe pode).
-- Tudo SECURITY DEFINER: a RLS esconde do cliente as linhas "só equipe", e o teste precisa vê-las.

create or replace function public.arrematado_tem_registro_equipe(p_id uuid)
 returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.caso_andamentos c where c.arrematado_id = p_id)
      or exists (select 1 from public.arrematados a
                   join public.imovel_anexos x on x.imovel_id::text = a.imovel_id::text
                  where a.id = p_id and x.role_criador in ('admin', 'analista', 'consultor', 'advogado'));
$$;
revoke all on function public.arrematado_tem_registro_equipe(uuid) from public, anon, authenticated;

create or replace function public.arrematado_protege_andamento()
 returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.caso_andamentos a where a.arrematado_id = old.id) then
    raise exception 'Este arremate tem andamento do processo registrado pela equipe e não pode ser removido. Fale com a equipe.'
      using errcode = 'P0001', hint = 'andamento_registrado';
  end if;
  if not public.eh_equipe() and public.arrematado_tem_registro_equipe(old.id) then
    raise exception 'Este arremate tem registros feitos pela equipe e não pode ser removido. Fale com a equipe.'
      using errcode = 'P0001', hint = 'andamento_registrado';
  end if;
  return old;
end $$;

-- Para a TELA esconder o "×": ids dos arremates DO PRÓPRIO usuário que têm registro da equipe.
create or replace function public.arremates_com_registro_equipe()
 returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select a.id from public.arrematados a
   where a.user_id = auth.uid() and public.arrematado_tem_registro_equipe(a.id);
$$;
revoke all on function public.arremates_com_registro_equipe() from public, anon;
grant execute on function public.arremates_com_registro_equipe() to authenticated;
