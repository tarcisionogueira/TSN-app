-- TAXAS REAIS DOS GATEWAYS (07/11, dono): "precisa trazer as taxas reais de cobrança de cada gateway; se a
-- integração não fornecer, documentar usando outro de referência e, ao realizar uma cobrança por ele, documentar
-- e passar a adotar a taxa utilizada."
--
-- Duas pontas por linha, porque são dinheiro de pessoas diferentes:
--   · RECEBEDOR (pct_recebedor + fixo_recebedor, com teto): o que o gateway retém da BidPro.
--   · CLIENTE (pct_cliente): juros que o gateway soma POR CIMA ao parcelar (Mercado Pago: payer_costs).
-- Cada ponta diz a sua origem: 'referencia' (tabela pública/documentada) → 'api' (o gateway informou) →
-- 'observada' (medida num pagamento real nosso). A observada vence: é o que de fato cobraram.
--
-- Por que existe: até 07/11 a tela usava uma tabela própria (2,49%–3,49% AO ANO) e mostrava 12× de R$ 6.000 =
-- R$ 6.209,40; a API do MP, para a nossa conta, cobra 22,11% do cliente no 12× = R$ 7.326,60.

create table if not exists public.gateway_taxas (
  gateway          text not null check (gateway in ('mercadopago','asaas','inter')),
  meio             text not null check (meio in ('cartao','pix','boleto')),
  parcelas         int  not null default 1 check (parcelas between 1 and 24),
  pct_recebedor    numeric(7,4),
  fixo_recebedor   numeric(10,2) not null default 0,
  teto_recebedor   numeric(10,2),
  fonte_recebedor  text not null default 'referencia' check (fonte_recebedor in ('referencia','api','observada')),
  detalhe_recebedor text,
  recebedor_em     timestamptz not null default now(),
  pct_cliente      numeric(7,4) not null default 0,
  fonte_cliente    text not null default 'referencia' check (fonte_cliente in ('referencia','api','observada')),
  detalhe_cliente  text,
  cliente_em       timestamptz not null default now(),
  primary key (gateway, meio, parcelas)
);

-- Cada cobrança real que passou: o que foi cobrado, o que entrou, o que o cliente pagou.
create table if not exists public.gateway_taxas_observadas (
  id           bigserial primary key,
  gateway      text not null,
  meio         text not null,
  parcelas     int  not null default 1,
  ref          text not null,
  valor        numeric(12,2) not null,
  liquido      numeric(12,2),
  total_pago   numeric(12,2),
  taxa         numeric(12,2),
  observado_em timestamptz not null default now(),
  unique (gateway, ref)
);

alter table public.gateway_taxas enable row level security;
alter table public.gateway_taxas_observadas enable row level security;
create policy gateway_taxas_admin_le on public.gateway_taxas for select to authenticated using (public.is_admin());
create policy gateway_taxas_obs_admin_le on public.gateway_taxas_observadas for select to authenticated using (public.is_admin());

-- REFERÊNCIA inicial (docs/HANDOFF.md 30/09 + medições de 07/11). A primeira cobrança real de cada linha substitui.
insert into public.gateway_taxas (gateway, meio, parcelas, pct_recebedor, fixo_recebedor, teto_recebedor, detalhe_recebedor, pct_cliente, fonte_cliente, detalhe_cliente)
select 'mercadopago', 'cartao', n, 4.98, 0, null,
       'referência: igual ao 1× medido (2,49% tarifa + 2,49% antecipação) — confirma no 1º parcelado real',
       coalesce(j.pct, 0), case when j.pct is null then 'referencia' else 'api' end,
       case when j.pct is null then null else 'API payment_methods/installments da nossa conta, 07/11' end
  from generate_series(1, 12) n
  left join (values (1,0.0),(2,9.64),(3,11.23),(4,11.36),(5,14.31),(6,14.32),(7,16.72),(8,16.73),(9,19.69),(10,20.65),(11,20.66),(12,22.11)) j(n2, pct) on j.n2 = n
on conflict do nothing;
insert into public.gateway_taxas (gateway, meio, parcelas, pct_recebedor, fixo_recebedor, teto_recebedor, detalhe_recebedor) values
  ('mercadopago','pix',   1, 1.00, 0,    null, 'referência: medido em 30/09 (fee_details, fee_payer=collector)'),
  ('mercadopago','boleto',1, 0,    3.49, null, 'referência: tarifa fixa por boleto pago (30/09)'),
  ('asaas','pix',         1, 0,    1.99, null, 'referência: tabela pública Asaas'),
  ('asaas','boleto',      1, 0,    3.49, null, 'referência: tabela pública Asaas'),
  ('inter','pix',         1, 0.99, 0,    1.99, 'referência: API Pix Cobrança com vencimento 0,99% (teto R$ 1,99) — busca, não conferido na página do Inter'),
  ('inter','boleto',      1, 0,    0,    null, 'referência: boleto grátis dentro da franquia mensal da conta — busca, não conferido')
on conflict do nothing;
insert into public.gateway_taxas (gateway, meio, parcelas, pct_recebedor, fixo_recebedor, detalhe_recebedor)
select 'asaas', 'cartao', n, case when n = 1 then 2.99 when n <= 6 then 3.49 else 3.99 end, 0.49,
       'referência: tabela pública Asaas (sem antecipação; crédito em ~30 dias)'
  from generate_series(1, 12) n
on conflict do nothing;

-- APRENDE com um pagamento real. Chamada pelo gatilho do mp_pagamentos e pelo webhook do Asaas.
-- Boleto/Pix fixos: a taxa observada vira o fixo. Percentuais: (taxa − fixo vigente) / valor.
create or replace function public.registrar_taxa_observada(
  p_gateway text, p_meio text, p_parcelas int, p_ref text, p_valor numeric, p_liquido numeric, p_total_pago numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_taxa numeric; v_lin public.gateway_taxas; v_pct numeric; v_pct_cli numeric; v_ins int;
begin
  -- coalesce: `null not in (...)` é NULL, não true — sem ele um meio desconhecido passava direto.
  if coalesce(p_gateway, '') not in ('mercadopago','asaas','inter') or coalesce(p_meio, '') not in ('cartao','pix','boleto') then return; end if;
  if coalesce(p_valor, 0) <= 0 or p_ref is null then return; end if;
  v_taxa := case when p_liquido is not null and p_liquido > 0 and p_liquido <= p_valor then round(p_valor - p_liquido, 2) end;
  insert into public.gateway_taxas_observadas (gateway, meio, parcelas, ref, valor, liquido, total_pago, taxa)
  values (p_gateway, p_meio, greatest(1, coalesce(p_parcelas, 1)), p_ref, p_valor, p_liquido, p_total_pago, v_taxa)
  on conflict (gateway, ref) do update
     set liquido = excluded.liquido, total_pago = excluded.total_pago, taxa = excluded.taxa, observado_em = now()
   where public.gateway_taxas_observadas.taxa is null and excluded.taxa is not null; -- aprovado antes de o dinheiro entrar
  get diagnostics v_ins = row_count;
  if v_ins = 0 then return; end if; -- já aprendido com este pagamento

  select * into v_lin from public.gateway_taxas where gateway = p_gateway and meio = p_meio and parcelas = greatest(1, coalesce(p_parcelas, 1));
  if not found then
    insert into public.gateway_taxas (gateway, meio, parcelas) values (p_gateway, p_meio, greatest(1, coalesce(p_parcelas, 1)))
    returning * into v_lin;
  end if;

  if v_taxa is not null then
    if p_meio = 'boleto' then
      update public.gateway_taxas set pct_recebedor = 0, fixo_recebedor = v_taxa, fonte_recebedor = 'observada',
             detalhe_recebedor = format('cobrança real %s: R$ %s de R$ %s', p_ref, v_taxa, p_valor), recebedor_em = now()
       where gateway = v_lin.gateway and meio = v_lin.meio and parcelas = v_lin.parcelas;
    elsif v_lin.teto_recebedor is null or v_taxa < v_lin.teto_recebedor then
      v_pct := round(greatest(0, v_taxa - coalesce(v_lin.fixo_recebedor, 0)) / p_valor * 100, 4);
      update public.gateway_taxas set pct_recebedor = v_pct, fonte_recebedor = 'observada',
             detalhe_recebedor = format('cobrança real %s: R$ %s de R$ %s', p_ref, v_taxa, p_valor), recebedor_em = now()
       where gateway = v_lin.gateway and meio = v_lin.meio and parcelas = v_lin.parcelas;
    end if;
  end if;

  -- Juros que o CLIENTE pagou por cima (parcelado com juros do gateway).
  if coalesce(p_parcelas, 1) > 1 and p_total_pago is not null and p_total_pago >= p_valor then
    v_pct_cli := round((p_total_pago / p_valor - 1) * 100, 4);
    update public.gateway_taxas set pct_cliente = v_pct_cli, fonte_cliente = 'observada',
           detalhe_cliente = format('cobrança real %s: cliente pagou R$ %s sobre R$ %s', p_ref, p_total_pago, p_valor), cliente_em = now()
     where gateway = v_lin.gateway and meio = v_lin.meio and parcelas = v_lin.parcelas;
  end if;
end $$;
revoke all on function public.registrar_taxa_observada(text, text, int, text, numeric, numeric, numeric) from public, anon, authenticated;

-- O que a API do gateway informou (payer_costs do MP). Não passa por cima de uma observação real.
create or replace function public.gateway_taxas_da_api(p_gateway text, p_meio text, p_taxas jsonb, p_detalhe text)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; e jsonb;
begin
  for e in select * from jsonb_array_elements(coalesce(p_taxas, '[]'::jsonb)) loop
    insert into public.gateway_taxas (gateway, meio, parcelas, pct_cliente, fonte_cliente, detalhe_cliente, cliente_em, pct_recebedor, detalhe_recebedor)
    values (p_gateway, p_meio, (e->>'parcelas')::int, (e->>'pct_cliente')::numeric, 'api', p_detalhe, now(), null, null)
    on conflict (gateway, meio, parcelas) do update
       set pct_cliente = excluded.pct_cliente, fonte_cliente = 'api', detalhe_cliente = excluded.detalhe_cliente, cliente_em = now()
     where public.gateway_taxas.fonte_cliente <> 'observada' or public.gateway_taxas.cliente_em < now() - interval '30 days';
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.gateway_taxas_da_api(text, text, jsonb, text) from public, anon, authenticated;

-- Documentar uma taxa à mão (admin), quando o gateway não informa. Também vira 'referencia' até a 1ª cobrança real.
create or replace function public.gateway_taxa_documentar(
  p_gateway text, p_meio text, p_parcelas int, p_pct numeric, p_fixo numeric, p_teto numeric, p_pct_cliente numeric, p_detalhe text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'só admin documenta taxa de gateway'; end if;
  insert into public.gateway_taxas (gateway, meio, parcelas, pct_recebedor, fixo_recebedor, teto_recebedor, fonte_recebedor, detalhe_recebedor, recebedor_em,
                                    pct_cliente, fonte_cliente, detalhe_cliente, cliente_em)
  values (p_gateway, p_meio, greatest(1, coalesce(p_parcelas, 1)), p_pct, coalesce(p_fixo, 0), p_teto, 'referencia', p_detalhe, now(),
          coalesce(p_pct_cliente, 0), 'referencia', p_detalhe, now())
  on conflict (gateway, meio, parcelas) do update
     set pct_recebedor = excluded.pct_recebedor, fixo_recebedor = excluded.fixo_recebedor, teto_recebedor = excluded.teto_recebedor,
         fonte_recebedor = 'referencia', detalhe_recebedor = excluded.detalhe_recebedor, recebedor_em = now(),
         pct_cliente = coalesce(p_pct_cliente, public.gateway_taxas.pct_cliente),
         fonte_cliente = case when p_pct_cliente is null then public.gateway_taxas.fonte_cliente else 'referencia' end,
         detalhe_cliente = case when p_pct_cliente is null then public.gateway_taxas.detalhe_cliente else excluded.detalhe_cliente end,
         cliente_em = case when p_pct_cliente is null then public.gateway_taxas.cliente_em else now() end;
end $$;
revoke all on function public.gateway_taxa_documentar(text, text, int, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.gateway_taxa_documentar(text, text, int, numeric, numeric, numeric, numeric, text) to authenticated;

-- Gatilho: todo pagamento APROVADO do Mercado Pago que é venda nossa (origem <> 'terceiro') ensina a taxa.
create or replace function public._mp_pagamento_ensina_taxa() returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb := new.dados_mp; v_meio text;
begin
  if new.status <> 'approved' or d is null or coalesce(new.origem, '') = 'terceiro' then return new; end if;
  v_meio := case d->>'payment_type_id' when 'credit_card' then 'cartao' when 'ticket' then 'boleto'
                 when 'bank_transfer' then case when d->>'payment_method_id' = 'pix' then 'pix' end end;
  if v_meio is null then return new; end if;
  begin
    perform public.registrar_taxa_observada('mercadopago', v_meio, coalesce((d->>'installments')::int, 1), 'mp:' || new.mp_payment_id,
      (d->>'transaction_amount')::numeric, nullif((d->'transaction_details'->>'net_received_amount')::numeric, 0),
      nullif((d->'transaction_details'->>'total_paid_amount')::numeric, 0));
  exception when others then
    raise warning '[_mp_pagamento_ensina_taxa] %: %', new.mp_payment_id, sqlerrm; -- nunca derruba o espelho do pagamento
  end;
  return new;
end $$;
create or replace trigger trg_mp_pagamento_ensina_taxa after insert or update of status, dados_mp on public.mp_pagamentos
  for each row execute function public._mp_pagamento_ensina_taxa();

-- Aprende com o que já passou (ordem cronológica: a mais recente fica vigente).
do $$
declare r record;
begin
  for r in select * from public.mp_pagamentos where status = 'approved' and dados_mp is not null and coalesce(origem, '') <> 'terceiro' order by criado_em loop
    perform public.registrar_taxa_observada('mercadopago',
      case r.dados_mp->>'payment_type_id' when 'credit_card' then 'cartao' when 'ticket' then 'boleto'
           when 'bank_transfer' then case when r.dados_mp->>'payment_method_id' = 'pix' then 'pix' end end,
      coalesce((r.dados_mp->>'installments')::int, 1), 'mp:' || r.mp_payment_id,
      (r.dados_mp->>'transaction_amount')::numeric, nullif((r.dados_mp->'transaction_details'->>'net_received_amount')::numeric, 0),
      nullif((r.dados_mp->'transaction_details'->>'total_paid_amount')::numeric, 0));
  end loop;
end $$;
