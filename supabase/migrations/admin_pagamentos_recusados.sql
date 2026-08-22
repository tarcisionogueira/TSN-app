-- 22/08 — Traduz o código de recusa do Mercado Pago (status_detail) para o motivo em PT + a
-- ação sugerida, e expõe as recusas recentes no ADMIN (antes só dava para ler no banco/equipe).
create or replace function public.mp_motivo_recusa(p_code text)
returns text language sql immutable as $$
  select case p_code
    when 'cc_rejected_high_risk'            then 'Prevenção a fraude do Mercado Pago (alto risco) — NÃO é saldo. Sugira outro cartão/meio ou contato com o emissor.'
    when 'cc_rejected_insufficient_amount'  then 'Saldo/limite insuficiente no cartão.'
    when 'cc_rejected_bad_filled_security_code' then 'Código de segurança (CVV) incorreto.'
    when 'cc_rejected_bad_filled_date'      then 'Data de validade incorreta.'
    when 'cc_rejected_bad_filled_card_number' then 'Número do cartão incorreto.'
    when 'cc_rejected_bad_filled_other'     then 'Algum dado do cartão está incorreto.'
    when 'cc_rejected_call_for_authorize'   then 'O emissor exige autorização — cliente deve ligar para o banco e autorizar a compra.'
    when 'cc_rejected_card_disabled'        then 'Cartão desabilitado — cliente deve ligar para o emissor e ativar o cartão.'
    when 'cc_rejected_card_error'           then 'Erro no processamento do cartão — tentar novamente.'
    when 'cc_rejected_duplicated_payment'   then 'Pagamento duplicado (já havia um igual).'
    when 'cc_rejected_max_attempts'         then 'Número máximo de tentativas atingido.'
    when 'cc_rejected_invalid_installments' then 'Número de parcelas inválido para este cartão.'
    when 'cc_rejected_blacklist'            then 'Recusado por lista de restrição do Mercado Pago.'
    when 'cc_rejected_other_reason'         then 'Recusado pelo emissor (motivo não especificado).'
    when 'cc_rejected_time_out'             then 'Tempo de resposta esgotado no processamento.'
    when 'cc_amount_rate_limit_exceeded'    then 'Limite de valor por período excedido.'
    when 'rejected_by_bank'                 then 'Recusado pelo banco emissor.'
    when 'rejected_insufficient_data'       then 'Dados insuficientes para processar.'
    when 'cc_rejected_bad_filled_combination' then 'Combinação de dados do cartão inconsistente.'
    when 'cc_rejected_bad_filled_low_authorized_amount' then 'Valor abaixo do mínimo autorizado.'
    when null                               then 'Sem código de detalhe informado.'
    else 'Recusado — código do Mercado Pago: ' || coalesce(p_code, '(nulo)')
  end;
$$;

create or replace function public.admin_pagamentos_recusados(p_dias int default 90)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog' as $$
declare v jsonb;
begin
  if not public.eh_admin() then raise exception 'apenas admin'; end if;
  select coalesce(jsonb_agg(t order by t->>'em' desc), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'user_id', p.user_id, 'nome', pf.nome, 'email', u.email,
      'valor', p.valor, 'metodo', p.metodo, 'origem', p.origem,
      'codigo', p.status_detalhe, 'motivo', public.mp_motivo_recusa(p.status_detalhe),
      'plano', p.plano_key, 'em', p.criado_em
    ) as t
    from public.mp_pagamentos p
    left join public.perfis pf on pf.id = p.user_id
    left join auth.users u on u.id = p.user_id
    where p.status in ('rejected','cancelled')
      and p.criado_em > now() - make_interval(days => greatest(1, p_dias))
  ) s;
  return v;
end $$;
revoke execute on function public.admin_pagamentos_recusados(int) from anon, public;
grant execute on function public.admin_pagamentos_recusados(int) to authenticated;
