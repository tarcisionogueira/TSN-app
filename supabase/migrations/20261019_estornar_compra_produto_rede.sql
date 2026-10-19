-- 19/10 (bug bounty): reembolso/chargeback de CURSO cancelava a linha em `comissoes`, mas o saldo
-- dos níveis de rede continuava sacável — distribuir_comissao_rede_curso (16/10) grava em
-- saldo_lancamentos com origem_id = <pay>-prod-n<nível>, e o estorno só olhava <pay>-prod.
create or replace function public.estornar_compra_produto(p_gateway_payment_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int := 0;
begin
  if coalesce(p_gateway_payment_id,'') = '' then return jsonb_build_object('ok',false,'erro','sem_id'); end if;
  update public.compras_produtos set status='estornado'
    where gateway_payment_id = p_gateway_payment_id and status='ativo';
  get diagnostics v_n = row_count;
  update public.saldo_lancamentos set status='cancelado'
    where (origem_id = p_gateway_payment_id || '-prod'
           or origem_id like replace(replace(p_gateway_payment_id, '%', '\%'), '_', '\_') || '-prod-n%')
      and status <> 'cancelado';
  update public.comissoes set status='cancelado'
    where gateway_payment_id = p_gateway_payment_id and origem='produto' and status <> 'cancelado';
  return jsonb_build_object('ok',true,'compras_estornadas',v_n);
end; $function$;
