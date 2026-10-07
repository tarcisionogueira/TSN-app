-- CANCELAR O BOLETO NÃO PODE DEIXAR A PARCELA PRESA (07/10, revisão da cobrança do serviço).
--
-- `cobrancas_avulsas` é editável pelo ADMIN direto pelo RLS (policy `cobrancas_avulsas_update`), e a
-- tela do Financeiro lista todas — inclusive as do cartório, que de lá não se distinguem das demais.
-- Cancelar uma delas deixava a parcela em 'cobrada' apontando para uma cobrança morta, e
-- `cobrarParcela` é idempotente: ela devolve o MESMO link quando a parcela já está 'cobrada'. Ou seja,
-- o cliente receberia para sempre um link que não aceita mais pagamento, o serviço nunca chegaria a
-- 'pronto_para_protocolo' e a trava do protocolo continuaria recusando — sem nada no sistema dizendo
-- por quê. O gatilho já sabia desfazer o ESTORNO (paga → outra coisa); faltava o caso mais banal,
-- aberta → cancelada.
--
-- Quem cancela o SERVIÇO inteiro continua mandando: ali a parcela deve mesmo ficar 'cancelada', então
-- a liberação só vale enquanto o serviço está vivo.
create or replace function public.servico_cartorio_baixa_parcela()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_servico uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'paga' then
    update public.servicos_cartorio_parcelas
       set status = 'paga', paga_em = coalesce(new.pago_em, now())
     where cobranca_avulsa_id = new.id and status <> 'paga'
     returning servico_id into v_servico;
  elsif old.status = 'paga' then
    update public.servicos_cartorio_parcelas
       set status = case when new.status = 'cancelada' then 'cancelada' else 'cobrada' end, paga_em = null
     where cobranca_avulsa_id = new.id
     returning servico_id into v_servico;
  elsif new.status = 'cancelada' and old.status = 'aberta' then
    -- Boleto cancelado sem ter sido pago: a parcela volta a 'pendente' e SOLTA o vínculo
    -- (`cobranca_avulsa_id` é unique), para que "Cobrar" emita um boleto novo em vez de
    -- devolver o link morto.
    update public.servicos_cartorio_parcelas p
       set status = 'pendente', cobranca_avulsa_id = null
     where p.cobranca_avulsa_id = new.id and p.status = 'cobrada'
       and exists (select 1 from public.servicos_cartorio s where s.id = p.servico_id and s.status <> 'cancelado')
     returning p.servico_id into v_servico;
  end if;
  if v_servico is not null then
    -- avança/recua o status do serviço conforme o que está pago
    update public.servicos_cartorio s set
      status = case
        when s.status in ('protocolado','exigencia','registrado','cancelado') then s.status
        when not exists (select 1 from public.servicos_cartorio_parcelas p where p.servico_id = s.id and p.status not in ('paga','cancelada'))
          then 'pronto_para_protocolo'
        -- voltou a haver parcela em aberto: 'pronto_para_protocolo' deixa de ser verdade.
        when s.status = 'pronto_para_protocolo' then 'em_preparo'
        when s.status = 'aguardando_pagamento'
             and exists (select 1 from public.servicos_cartorio_parcelas p where p.servico_id = s.id and p.momento = 'contratacao' and p.status = 'paga')
          then 'em_preparo'
        else s.status end,
      atualizado_em = now()
    where s.id = v_servico;
  end if;
  return new;
end $$;

revoke execute on function public.servico_cartorio_baixa_parcela() from public, anon, authenticated;
