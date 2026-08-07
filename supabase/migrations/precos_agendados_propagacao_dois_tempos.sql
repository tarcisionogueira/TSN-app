-- PREÇO AGENDADO EM DOIS TEMPOS — a falha de propagação deixa de ser definitiva.
--
-- Problema (achado em 07/08): `aplicar_precos_agendados` fazia o UPDATE e o RETURNING no
-- MESMO statement. No instante em que devolvia as mudanças ao cron, `preco_agendado` e
-- `preco_vigencia` já tinham sido zerados. A propagação aos gateways vinha DEPOIS e era
-- best-effort: se o Mercado Pago respondesse 500 naquele minuto, o preço no banco já era o
-- novo (checkouts novos cobrando certo), os assinantes existentes seguiam no valor ANTIGO
-- para sempre, e o par (de → para) necessário para localizar os mandatos não existia mais
-- em lugar nenhum. Perda silenciosa e irreversível.
--
-- Correção: aplicar e propagar viram etapas separadas.
--   1) A RPC aplica o preço, GUARDA o valor anterior e marca `propagacao_pendente`.
--      Continua limpando `preco_agendado`/`preco_vigencia` — senão o preço seria reaplicado
--      a cada execução e a janela de agendamento nunca fecharia.
--   2) O cron propaga e só então baixa a marca. Enquanto pendente, toda execução seguinte
--      re-tenta com o par preservado. Retentar é seguro: o PUT no gateway é idempotente
--      (define o valor final, não incrementa) e o filtro só casa mandato que ainda está no
--      valor antigo.
--
-- Urgência real: há uma troca AGENDADA para 01/10 (top2 49,90→89,90 e anual 449,90→899).
alter table public.planos_config
  add column if not exists propagacao_pendente   boolean not null default false,
  add column if not exists preco_anterior        numeric,
  add column if not exists preco_anual_anterior  numeric,
  add column if not exists propagacao_em         timestamptz;

comment on column public.planos_config.propagacao_pendente is
  'true = o preço já mudou no banco mas ainda não foi confirmado nos gateways. O cron aplicar-precos-agendados re-tenta enquanto estiver true.';
comment on column public.planos_config.preco_anterior is
  'Preço mensal ANTES da última aplicação. Sem ele não há como achar o mandato a reprecificar numa retentativa.';

create or replace function public.aplicar_precos_agendados()
returns table(plano_key text, preco_antigo numeric, preco_novo numeric, preco_anual_antigo numeric, preco_anual_novo numeric)
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
          -- GUARDA o antes: é o que permite a retentativa achar o mandato.
          preco_anterior = antes.p_antigo,
          preco_anual_anterior = antes.pa_antigo,
          propagacao_pendente = true,
          propagacao_em = now(),
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

-- Fila de propagação: o que ainda não foi confirmado nos gateways, seja da execução de
-- agora ou de uma anterior que falhou. É por aqui que o cron passa a iterar — antes ele só
-- via o retorno da RPC, então uma falha nunca era retomada.
create or replace function public.precos_propagacao_pendente()
returns table(plano_key text, preco_antigo numeric, preco_novo numeric, preco_anual_antigo numeric, preco_anual_novo numeric)
language sql
security definer
set search_path to 'public'
as $function$
  select p.plano_key, p.preco_anterior, p.preco, p.preco_anual_anterior, p.preco_anual
  from public.planos_config p
  where p.propagacao_pendente is true;
$function$;

-- Baixa a marca quando os dois gateways confirmaram. Chamada só pelo cron.
create or replace function public.precos_propagacao_confirmar(p_plano_key text)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  update public.planos_config
     set propagacao_pendente = false, preco_anterior = null, preco_anual_anterior = null
   where plano_key = p_plano_key and propagacao_pendente is true
  returning true;
$function$;

-- Service-only: quem aplica preço é o cron. Cliente não tem o que fazer aqui.
revoke all on function public.precos_propagacao_pendente() from public, anon, authenticated;
revoke all on function public.precos_propagacao_confirmar(text) from public, anon, authenticated;
grant execute on function public.precos_propagacao_pendente() to service_role;
grant execute on function public.precos_propagacao_confirmar(text) to service_role;
