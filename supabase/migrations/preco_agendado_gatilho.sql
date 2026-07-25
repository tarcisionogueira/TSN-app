-- Gatilho de preço agendado (Cobrança passo 8). Permite agendar um novo preço (mensal e/ou
-- anual) do plano para uma DATA FUTURA. Quando a vigência chega, um cron diário aplica o preço
-- direto no planos_config (fonte única lida pelo front E pelo back) — então, a partir da virada,
-- todo NOVO checkout já cobra o preço novo, sem mexer no código de checkout.
--
-- Grandfather: assinantes atuais NÃO são afetados — a recorrência no gateway (MP/Asaas) mantém o
-- valor contratado na criação da assinatura. Se o cliente suspender/parar de pagar, ele cai para
-- Explorador (fluxo de webhook), e ao ASSINAR de novo cria uma nova recorrência, que lê o preço
-- vigente (o novo). Ou seja: quem manteve a assinatura ativa segue no preço antigo; quem lapsou
-- e voltar paga o novo.

alter table public.planos_config
  add column if not exists preco_agendado numeric,
  add column if not exists preco_anual_agendado numeric,
  add column if not exists preco_vigencia timestamptz;

comment on column public.planos_config.preco_agendado is 'Novo preço mensal que passa a valer em preco_vigencia (aplicado pelo cron aplicar_precos_agendados).';
comment on column public.planos_config.preco_anual_agendado is 'Novo preço anual que passa a valer em preco_vigencia.';
comment on column public.planos_config.preco_vigencia is 'Data/hora em que o preço agendado entra em vigor.';

-- Aplica os agendamentos VENCIDOS (idempotente): vira o preço e limpa o agendamento. Chamada
-- pelo cron diário. SECURITY DEFINER para escrever no planos_config independentemente de RLS;
-- SEM execução por anon/authenticated (mantém a auditoria de segurança 0/0).
create or replace function public.aplicar_precos_agendados()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  with aplicados as (
    update public.planos_config
      set preco = coalesce(preco_agendado, preco),
          preco_anual = coalesce(preco_anual_agendado, preco_anual),
          preco_agendado = null,
          preco_anual_agendado = null,
          preco_vigencia = null,
          atualizado_em = now()
    where preco_vigencia is not null and preco_vigencia <= now()
    returning 1
  )
  select count(*) into v_n from aplicados;
  return v_n;
end;
$function$;

revoke all on function public.aplicar_precos_agendados() from public;
revoke all on function public.aplicar_precos_agendados() from anon;
revoke all on function public.aplicar_precos_agendados() from authenticated;
grant execute on function public.aplicar_precos_agendados() to service_role;
