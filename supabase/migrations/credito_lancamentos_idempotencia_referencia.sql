-- Bug bounty 31/07 (item #2, ALTO) — APLICADO. creditar_credito era check-then-act sem
-- trava no banco → N requisições concorrentes com o mesmo paymentId creditavam N vezes
-- (TOCTOU). Trava: índice único parcial na referência dos CRÉDITOS + ON CONFLICT na RPC.
create unique index if not exists credito_lanc_referencia_credito_uidx
  on public.credito_lancamentos(referencia)
  where tipo = 'credito' and referencia is not null;

create or replace function public.creditar_credito(
  p_user_id uuid, p_valor numeric, p_origem text, p_referencia text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_saldo numeric; v_ins bigint;
begin
  if p_user_id is null or coalesce(p_valor,0) <= 0 then return jsonb_build_object('ok',false,'erro','invalido'); end if;
  if p_referencia is not null then
    insert into public.credito_lancamentos(user_id,tipo,funcionalidade,valor,saldo_apos,justificativa,referencia)
      values (p_user_id,'credito',coalesce(p_origem,'recarga'),p_valor,0,'Recarga de crédito',p_referencia)
      on conflict (referencia) where (tipo='credito' and referencia is not null) do nothing
      returning id into v_ins;
    if v_ins is null then
      return jsonb_build_object('ok',true,'ja_creditado',true,'saldo',(select credito_saldo from public.perfis where id=p_user_id));
    end if;
    update public.perfis set credito_saldo = credito_saldo + p_valor where id = p_user_id
      returning credito_saldo into v_saldo;
    update public.credito_lancamentos set saldo_apos = v_saldo where id = v_ins;
    return jsonb_build_object('ok',true,'saldo',v_saldo);
  end if;
  update public.perfis set credito_saldo = credito_saldo + p_valor where id = p_user_id
    returning credito_saldo into v_saldo;
  if v_saldo is null then return jsonb_build_object('ok',false,'erro','sem_perfil'); end if;
  insert into public.credito_lancamentos(user_id,tipo,funcionalidade,valor,saldo_apos,justificativa,referencia)
    values (p_user_id,'credito',coalesce(p_origem,'recarga'),p_valor,v_saldo,'Recarga de crédito',p_referencia);
  return jsonb_build_object('ok',true,'saldo',v_saldo);
end; $function$;

revoke all on function public.creditar_credito(uuid,numeric,text,text) from public, anon, authenticated;
grant execute on function public.creditar_credito(uuid,numeric,text,text) to service_role;
