-- ─────────────────────────────────────────────────────────────────────────────────────────
-- #248 (20/10): reembolso/chargeback de RECARGA de crédito não tirava o crédito do saldo — nenhum caminho
-- escrevia em credito_lancamentos no estorno. O cliente pagava, usava (ou não) e pedia o dinheiro de volta
-- ficando com o saldo. Nenhuma recarga feita até hoje (0 lançamentos): latente.
--
-- `p_total_estornado` é o ACUMULADO devolvido pelo gateway (MP: transaction_amount_refunded; chargeback: o
-- valor inteiro). Debita só a diferença para o que já foi debitado por esta recarga → reembolso parcial, total
-- e chargeback em sequência, e a reentrega do webhook, nunca debitam duas vezes. A linha do perfil é travada
-- (for update) para que duas notificações simultâneas não leiam o mesmo "já debitado".
-- O saldo PODE ficar negativo (crédito já gasto): debitar_credito barra o uso enquanto estiver abaixo do custo.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.estornar_recarga_credito(p_referencia text, p_total_estornado numeric, p_motivo text default 'estorno')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cred record; v_ja numeric; v_delta numeric; v_saldo numeric; v_n int;
begin
  if coalesce(p_referencia,'') = '' or coalesce(p_total_estornado,0) <= 0 then
    return jsonb_build_object('ok',false,'erro','parametros');
  end if;
  select id, user_id, valor into v_cred from public.credito_lancamentos
   where tipo = 'credito' and referencia = p_referencia;
  if v_cred.id is null then return jsonb_build_object('ok',true,'sem_recarga',true); end if;

  perform 1 from public.perfis where id = v_cred.user_id for update;

  select coalesce(sum(valor),0), count(*) into v_ja, v_n from public.credito_lancamentos
   where tipo = 'debito' and referencia like p_referencia || ':estorno:%';
  v_delta := round(least(p_total_estornado, v_cred.valor) - v_ja, 2);
  if v_delta <= 0 then return jsonb_build_object('ok',true,'ja_estornado',true,'debitado',v_ja); end if;

  update public.perfis set credito_saldo = coalesce(credito_saldo,0) - v_delta where id = v_cred.user_id
    returning credito_saldo into v_saldo;
  insert into public.credito_lancamentos(user_id, tipo, funcionalidade, valor, saldo_apos, justificativa, referencia)
    values (v_cred.user_id, 'debito', 'estorno_recarga', v_delta, v_saldo,
            'Estorno da recarga (' || coalesce(p_motivo,'estorno') || ')', p_referencia || ':estorno:' || (v_n + 1));
  return jsonb_build_object('ok',true,'debitado',v_delta,'debitado_total',v_ja + v_delta,'saldo',v_saldo);
end; $function$;

revoke all on function public.estornar_recarga_credito(text, numeric, text) from public, anon, authenticated;
grant execute on function public.estornar_recarga_credito(text, numeric, text) to service_role;
