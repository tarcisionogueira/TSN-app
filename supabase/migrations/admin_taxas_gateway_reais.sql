-- 02/09, pedido do dono: "os percentuais do Asaas e do Mercado Pago nao fazem sentido
-- editaveis — e para puxar o real do sistema, e numa tela de DRE ver quanto pagamos".
--
-- A taxa real SEMPRE esteve no banco: cada linha de `mp_pagamentos` guarda o payload do
-- Mercado Pago em `dados_mp`, com `fee_details[]` e `transaction_details.net_received_amount`.
-- O que existia era `config_financeira.taxa_credito_pct`, um numero DIGITADO no /admin que
-- a tela de comissoes usava como se fosse fato.
--
-- TRES cuidados que esta funcao toma, e que um `sum(fee)/sum(valor)` nao tomaria:
--  1. `fee_payer` — so a taxa com `fee_payer='collector'` e custo NOSSO. A do `payer`
--     (ex.: IOF) quem paga e o cliente; somar as duas inflaria a taxa.
--  2. `origem` — `terceiro` sao lancamentos do cartao do dono que caem na mesma conta MP
--     (Anthropic, etc.). Nao sao venda: entram no extrato, nao no MDR do gateway.
--  3. O DENOMINADOR — pagamento aprovado que ainda nao trouxe `fee_details` (o `metodo`
--     'recorrente' vem sem) entra no bruto mas nao na taxa. Dividir a taxa pelo bruto TOTAL
--     daria um percentual menor do que o real e com cara de medicao (forma #10 do CLAUDE.md).
--     Por isso `pct_efetivo` e calculado so sobre `bruto_medido`, e `sem_detalhe` sai junto
--     para a tela poder dizer sobre quantos pagamentos o numero fala.
--
-- O Asaas nao tem tabela local (e o gateway de BACKUP; o extrato dele vive na API). A linha
-- vem com `pct_efetivo` NULO de proposito: zero pareceria "o Asaas nao cobra taxa".
create or replace function public.admin_taxas_gateway(p_dias integer default 90)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_mp    jsonb;
  v_desde timestamptz := now() - make_interval(days => greatest(1, p_dias));
begin
  if not public.eh_admin() then raise exception 'apenas admin'; end if;

  with base as (
    select p.valor,
           p.criado_em,
           (select sum((f->>'amount')::numeric)
              from jsonb_array_elements(coalesce(p.dados_mp->'fee_details', '[]'::jsonb)) f
             where f->>'fee_payer' = 'collector') as taxa
      from public.mp_pagamentos p
     where p.status = 'approved'
       and coalesce(p.origem, '') in ('avulso', 'recorrente')
       and p.criado_em > v_desde
  )
  select jsonb_build_object(
    'gateway',      'mercadopago',
    'rotulo',       'Mercado Pago',
    'pagamentos',   count(*),
    'bruto',        coalesce(sum(valor), 0),
    'com_detalhe',  count(*) filter (where taxa is not null),
    'sem_detalhe',  count(*) filter (where taxa is null),
    'bruto_medido', coalesce(sum(valor) filter (where taxa is not null), 0),
    'taxa_total',   coalesce(sum(taxa), 0),
    'pct_efetivo',  case when coalesce(sum(valor) filter (where taxa is not null), 0) > 0
                         then round(coalesce(sum(taxa), 0) * 100
                                    / sum(valor) filter (where taxa is not null), 4)
                    end,
    'primeiro',     min(criado_em),
    'ultimo',       max(criado_em)
  ) into v_mp
  from base;

  return jsonb_build_object(
    'dias',  greatest(1, p_dias),
    'desde', v_desde,
    'gateways', jsonb_build_array(
      v_mp,
      jsonb_build_object(
        'gateway',     'asaas',
        'rotulo',      'Asaas',
        'pagamentos',  0,
        'bruto',       0,
        'com_detalhe', 0,
        'sem_detalhe', 0,
        'bruto_medido', 0,
        'taxa_total',  0,
        'pct_efetivo', null,
        'nota',        'Gateway de backup: nenhuma venda registrada localmente. O extrato do Asaas e lido pela API em /admin/financeiro.'
      )
    )
  );
end $function$;

revoke all on function public.admin_taxas_gateway(integer) from public, anon;
grant execute on function public.admin_taxas_gateway(integer) to authenticated;
