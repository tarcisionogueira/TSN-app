-- Hardening (achado do Supabase security advisor, 18/09): as duas funções de trigger de
-- honorarios_recebimentos não tinham search_path fixo. Não são SECURITY DEFINER e todo
-- acesso a tabela já vem qualificado com `public.` (não há como um search_path mutável
-- redirecionar a leitura), então não é exploravel — mas fixar o search_path é o hardening
-- padrão do Postgres e fecha o lint sem mudar comportamento.
create or replace function public.honorarios_recebimentos_fecha_se_completo()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_arr uuid := coalesce(new.arrematacao_id, old.arrematacao_id);
  v_total numeric(15,2); v_somado numeric(15,2); v_status text;
begin
  select honorarios_valor, honorarios_status into v_total, v_status from public.arrematacoes where id = v_arr;
  if v_status = 'distribuido' or v_total is null or v_total <= 0 then return coalesce(new, old); end if;
  select coalesce(sum(valor),0) into v_somado from public.honorarios_recebimentos
    where arrematacao_id = v_arr and status = 'confirmado';
  if v_somado >= (v_total - 0.01) and v_status <> 'pago' then
    update public.arrematacoes set honorarios_status = 'pago', honorarios_pago_em = now() where id = v_arr;
  elsif v_somado < (v_total - 0.01) and v_status = 'pago' then
    update public.arrematacoes set honorarios_status = 'pendente', honorarios_pago_em = null where id = v_arr;
  end if;
  return coalesce(new, old);
end $function$;

create or replace function public.honorarios_recebimentos_valida_teto()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_total numeric(15,2); v_somado numeric(15,2);
begin
  if new.status <> 'confirmado' then return new; end if;
  select honorarios_valor into v_total from public.arrematacoes where id = new.arrematacao_id;
  select coalesce(sum(valor),0) into v_somado from public.honorarios_recebimentos
    where arrematacao_id = new.arrematacao_id and status = 'confirmado' and id <> new.id;
  if (v_somado + new.valor) > (coalesce(v_total,0) + 0.01) then
    raise exception 'Recebimento de R$ % ultrapassa o saldo de honorários (R$ % já confirmado de R$ % total).', new.valor, v_somado, v_total;
  end if;
  return new;
end $function$;
