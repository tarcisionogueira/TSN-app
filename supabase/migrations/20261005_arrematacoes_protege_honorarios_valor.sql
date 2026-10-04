-- 05/10 — Pendência 115 (achado na triagem, era P3 e é P0): o arrematante podia BAIXAR o próprio
-- honorário. A política arrematacoes_update_consolidada deixa o arrematante atualizar a própria
-- linha, e a trigger só congelava honorarios_status/split. Um PATCH em honorarios_valor=1 pelo
-- PostgREST e o checkout (mp-checkout/asaas leem o valor do banco) cobrava R$ 1; o webhook e
-- honorarios_recebimentos_fecha_se_completo marcavam 'pago'. Também dava para forjar
-- honorarios_pago_em / gateway_payment_id / recibo_enviado_em.
--
-- Agora, para quem NÃO é service_role/admin/analista:
--  • o VALOR do honorário é sempre calculado pelo banco (config_honorarios: total_pct sobre o
--    valor arrematado, com o piso honorario_minimo) — o número que a tela manda é ignorado;
--  • valor_arrematado só muda enquanto o honorário está 'pendente' (corrigir digitação antes de
--    pagar), e o honorário é recalculado junto; depois disso fica congelado;
--  • campos de pagamento (pago_em, gateway_payment_id, recibo_enviado_em) nunca vêm do cliente.
create or replace function public.arrematacoes_protege_honorarios()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pct numeric; v_min numeric;
begin
  if auth.role() = 'service_role' or public.app_role() in ('admin','analista') then
    return new;
  end if;
  select coalesce(total_pct, 10), coalesce(honorario_minimo, 7000) into v_pct, v_min
    from public.config_honorarios where id = 1;
  v_pct := coalesce(v_pct, 10); v_min := coalesce(v_min, 7000);

  if tg_op = 'INSERT' then
    new.honorarios_status := 'pendente';
    new.honorarios_split  := null;
    new.honorarios_pago_em := null;
    new.honorarios_gateway_payment_id := null;
    new.honorarios_recibo_enviado_em := null;
    new.honorarios_valor := greatest(coalesce(new.valor_arrematado, 0) * v_pct / 100, v_min);
  else
    new.honorarios_status := old.honorarios_status;
    new.honorarios_split  := old.honorarios_split;
    new.honorarios_pago_em := old.honorarios_pago_em;
    new.honorarios_gateway_payment_id := old.honorarios_gateway_payment_id;
    new.honorarios_recibo_enviado_em := old.honorarios_recibo_enviado_em;
    -- Recalcula SÓ quando o valor arrematado muda: anexar documento (Caso.jsx) também é atualização do
    -- cliente, e recalcular sempre apagaria um honorário negociado pelo admin.
    if old.honorarios_status = 'pendente' and new.valor_arrematado is distinct from old.valor_arrematado then
      new.honorarios_valor := greatest(coalesce(new.valor_arrematado, 0) * v_pct / 100, v_min);
    elsif old.honorarios_status = 'pendente' then
      new.honorarios_valor := old.honorarios_valor;
    else
      new.valor_arrematado := old.valor_arrematado;
      new.honorarios_valor := old.honorarios_valor;
    end if;
  end if;
  return new;
end $function$;
