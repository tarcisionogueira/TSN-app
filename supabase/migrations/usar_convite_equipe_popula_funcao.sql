-- 22/08 — usar_convite_equipe passa a popular funcao_equipe para STAFF (aditivo, sobre a
-- fundação de funcao_equipe_fundacao.sql). Mantém o role para não regredir a autorização atual
-- (que ainda lê role); a virada role→tier de plano para staff é a fase dedicada e testada.
-- Consultor/parceiro segue como capacidade (vendedor_tipo), com role/plano preservado.

create or replace function public.usar_convite_equipe(p_token text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_convite record;
  v_role text;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'erro', 'não autorizado');
  end if;

  select * into v_convite from public.convites_equipe where token = p_token limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Convite inválido', 'motivo', 'inexistente');
  end if;
  if v_convite.usado_em is not null or v_convite.ativo = false then
    return jsonb_build_object('ok', false, 'erro', 'Convite já utilizado', 'motivo', 'usado');
  end if;
  if v_convite.expira_em is null or v_convite.expira_em <= now() then
    return jsonb_build_object('ok', false, 'erro', 'Convite expirado', 'motivo', 'expirado');
  end if;

  v_role := v_convite.roles[1];

  if v_role = 'consultor' then
    update public.perfis set vendedor_tipo = 'consultor', updated_at = now() where id = p_user_id;
    begin perform public.gerar_codigo_indicacao(p_user_id); exception when others then null; end;
  else
    update public.perfis set role = v_role, funcao_equipe = v_role, updated_at = now() where id = p_user_id;
  end if;

  update public.convites_equipe
     set usado_em = now(), usado_por = p_user_id, ativo = false
   where id = v_convite.id and usado_em is null and ativo = true;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Convite já utilizado', 'motivo', 'usado');
  end if;

  return jsonb_build_object('ok', true, 'roles', v_convite.roles, 'role_principal', v_role);
end;
$function$;

revoke execute on function public.usar_convite_equipe(text, uuid) from anon, public;
grant execute on function public.usar_convite_equipe(text, uuid) to authenticated;
