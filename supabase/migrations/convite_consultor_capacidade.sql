-- 22/08 — REVISA a atribuição do link de convite para o papel CONSULTOR, alinhando ao modelo
-- do sistema comercial (F1, 21/08): consultor é CAPACIDADE (perfis.vendedor_tipo='consultor'),
-- NÃO um role de plano.
--
-- Antes: usar_convite_equipe gravava `perfis.role = roles[1]` para QUALQUER papel — inclusive
-- 'consultor'. Isso (a) trocava o role/plano da pessoa (um cliente pagante viraria 'consultor' e
-- perderia o plano) e (b) NÃO satisfazia o gate do comercial (comercial_meus_leads exige
-- vendedor_tipo='consultor' ou admin — role='consultor' não passava), então o convidado virava
-- "consultor" que não enxergava lead nenhum. É a mesma incoerência que o bug bounty apontou.
--
-- Agora: convite de CONSULTOR habilita a capacidade e PRESERVA o role (o link funciona para
-- quem JÁ TEM CONTA — a RPC exige auth.uid()=p_user_id, então "habilita após identificação do
-- usuário"), e já garante o código de indicação. Os papéis de EQUIPE (analista/advogado/admin)
-- seguem gravando role, como antes. Idempotente.

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

  select * into v_convite
    from public.convites_equipe
   where token = p_token
   limit 1;

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
    -- CAPACIDADE comercial (F1): habilita vendedor_tipo e PRESERVA o role/plano da pessoa.
    update public.perfis set vendedor_tipo = 'consultor', updated_at = now() where id = p_user_id;
    -- garante o link de indicação do consultor (best-effort — não derruba o resgate)
    begin
      perform public.gerar_codigo_indicacao(p_user_id);
    exception when others then null;
    end;
  else
    update public.perfis set role = v_role, updated_at = now() where id = p_user_id;
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

revoke execute on function public.usar_convite_equipe(text, uuid) from anon;
revoke execute on function public.usar_convite_equipe(text, uuid) from public;
grant execute on function public.usar_convite_equipe(text, uuid) to authenticated;
