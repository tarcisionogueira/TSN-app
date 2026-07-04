-- Endurecimento de segurança (auditoria 2026-07-04)
-- 1) usar_convite_equipe: era executável por anon e alterava o role de QUALQUER
--    p_user_id sem vínculo com o chamador → escalonamento de privilégio.
--    Correção: exige sessão e só permite elevar o PRÓPRIO perfil. O resgate
--    diferido (signup com confirmação de e-mail) é feito pelo AuthContext após
--    o login, já autenticado.
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
  -- só o próprio usuário autenticado pode resgatar (bloqueia alvo arbitrário via anon key)
  if auth.uid() is null or p_user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'erro', 'não autorizado');
  end if;

  select * into v_convite
    from public.convites_equipe
    where token = p_token and ativo = true and usado_em is null
      and (expira_em is null or expira_em > now())
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Convite inválido ou já utilizado');
  end if;

  v_role := v_convite.roles[1];
  update public.perfis set role = v_role, updated_at = now() where id = p_user_id;
  update public.convites_equipe
     set usado_em = now(), usado_por = p_user_id, ativo = false
   where id = v_convite.id;
  return jsonb_build_object('ok', true, 'roles', v_convite.roles, 'role_principal', v_role);
end;
$function$;

revoke execute on function public.usar_convite_equipe(text, uuid) from anon;

-- 2) salvar_kyc_equipe: era write livre por token (overwrite + oráculo de token).
--    Correção: gravação única (kyc_fotos ainda nulo) e só em convite ativo.
--    Mantém executável por anon porque roda durante o cadastro (pré-sessão),
--    mas o alvo é sempre o próprio convite do token e não pode ser sobrescrito.
create or replace function public.salvar_kyc_equipe(p_token text, p_fotos jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.convites_equipe
     set kyc_fotos = p_fotos
   where token = p_token and ativo = true and kyc_fotos is null;
  return found;
end;
$function$;

-- 3) Enumeração de contas / vazamento de UUID: funções usadas apenas por
--    endpoints server-side (service key), nunca pelo cliente anônimo.
revoke execute on function public.get_user_id_by_email(text) from anon, authenticated;
revoke execute on function public.email_existe(text) from anon;
