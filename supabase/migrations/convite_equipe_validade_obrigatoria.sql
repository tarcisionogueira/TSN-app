-- ─────────────────────────────────────────────────────────────────────────────
-- CONVITE DE EQUIPE: VALIDADE OBRIGATÓRIA + USO ÚNICO EXPLÍCITO (dono, 05/08)
--
-- Regra do dono: "convite seria para equipe? se sim, ideal ter validade e ser de
-- uso único." O uso único JÁ era garantido (o RPC exige `usado_em is null` e, ao
-- resgatar, grava usado_em/usado_por e desliga `ativo`). A VALIDADE não: o filtro
-- era `(expira_em is null or expira_em > now())` — ou seja, convite criado sem
-- data NUNCA expirava. Um link de acesso privilegiado (analista/advogado/admin)
-- que vale para sempre é exatamente o que a auditoria de 04/07 quis evitar.
--
-- Duas travas, uma no dado e outra na regra:
--   1. `expira_em` NOT NULL com default de 7 dias — convite novo nasce com prazo
--      mesmo que quem criou não informe.
--   2. O RPC deixa de aceitar `expira_em is null` e passa a devolver o MOTIVO real
--      (expirado × já utilizado × inexistente), que o front usa para decidir se
--      descarta o token ou tenta de novo depois.
-- Idempotente. Convites abertos sem data ganham 7 dias a partir de agora.
-- ─────────────────────────────────────────────────────────────────────────────

update public.convites_equipe
   set expira_em = coalesce(expira_em, criado_em + interval '7 days', now() + interval '7 days')
 where expira_em is null;

alter table public.convites_equipe
  alter column expira_em set default (now() + interval '7 days');

alter table public.convites_equipe
  alter column expira_em set not null;

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

  -- Busca SEM os filtros de estado para poder distinguir o motivo — o front precisa
  -- saber se o convite morreu (descarta o token) ou se a falha foi transitória.
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
  -- VALIDADE agora é obrigatória: sem data válida, o convite não vale.
  if v_convite.expira_em is null or v_convite.expira_em <= now() then
    return jsonb_build_object('ok', false, 'erro', 'Convite expirado', 'motivo', 'expirado');
  end if;

  v_role := v_convite.roles[1];
  update public.perfis set role = v_role, updated_at = now() where id = p_user_id;
  -- USO ÚNICO: a condição no WHERE torna o resgate atômico — dois cliques simultâneos
  -- no mesmo link, apenas um grava (o outro não encontra a linha e cai no 'usado').
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
