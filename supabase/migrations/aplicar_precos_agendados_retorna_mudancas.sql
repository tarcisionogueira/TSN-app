-- Regra do dono (30/07): quando o admin altera o preço do plano, os assinantes ATIVOS
-- passam a pagar o preço novo na MENSALIDADE SEGUINTE (fim do "grandfather" de preço).
-- A propagação para os gateways é feita pelo cron (aplicar-precos-agendados-cron), que
-- precisa saber O QUE mudou (de quanto para quanto) para localizar as assinaturas no
-- Asaas (por valor+ciclo) e no Mercado Pago (por external_reference). Por isso a RPC
-- deixa de devolver só a contagem e passa a devolver as mudanças aplicadas.
--
-- Idempotente e retrocompatível no uso: quem só quer a contagem conta as linhas.

drop function if exists public.aplicar_precos_agendados();

create or replace function public.aplicar_precos_agendados()
returns table (
  plano_key           text,
  preco_antigo        numeric,
  preco_novo          numeric,
  preco_anual_antigo  numeric,
  preco_anual_novo    numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  with aplicados as (
    update public.planos_config pc
      set preco = coalesce(pc.preco_agendado, pc.preco),
          preco_anual = coalesce(pc.preco_anual_agendado, pc.preco_anual),
          preco_agendado = null,
          preco_anual_agendado = null,
          preco_vigencia = null,
          atualizado_em = now()
    from (
      select p.plano_key as pk, p.preco as p_antigo, p.preco_anual as pa_antigo,
             p.preco_agendado as p_novo, p.preco_anual_agendado as pa_novo
      from public.planos_config p
      where p.preco_vigencia is not null and p.preco_vigencia <= now()
      for update
    ) antes
    where pc.plano_key = antes.pk
    returning antes.pk, antes.p_antigo, coalesce(antes.p_novo, antes.p_antigo),
              antes.pa_antigo, coalesce(antes.pa_novo, antes.pa_antigo)
  )
  select * from aplicados;
end;
$function$;

revoke all on function public.aplicar_precos_agendados() from public;
revoke all on function public.aplicar_precos_agendados() from anon;
revoke all on function public.aplicar_precos_agendados() from authenticated;
grant execute on function public.aplicar_precos_agendados() to service_role;
