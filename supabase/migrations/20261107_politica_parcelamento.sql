-- POLÍTICA DE PARCELAMENTO POR PRODUTO (07/11, dono). Espelho em src/utils/parcelamento.js (POLITICA_PARCELAMENTO),
-- que a tela e o servidor (api/mp-checkout.js) usam. Mudou aqui, mude lá no mesmo commit.
--   sem_juros_ate = até quantas parcelas a BidPro ABSORVE os juros do Mercado Pago (acima disso, o cliente paga).
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo) values
('pagamento.parcelamento_por_produto',
 '{"assinatura_mensal":{"parcelas_max":1,"sem_juros_ate":1},
   "plano_anual":{"parcelas_max":12,"sem_juros_ate":12},
   "assessoria_vista":{"parcelas_max":1,"sem_juros_ate":1},
   "assessoria_parcelada":{"parcelas_max":12,"sem_juros_ate":12},
   "ebook":{"parcelas_max":1,"sem_juros_ate":1},
   "curso":{"parcelas_max":12,"sem_juros_ate":12},
   "honorario_exito":{"parcelas_max":12,"sem_juros_ate":1},
   "registro_imovel":{"parcelas_max":12,"sem_juros_ate":1},
   "cobranca_avulsa":{"definido_na_cobranca":true}}'::jsonb,
 'Dono, 07/11: mensalidade à vista e anual em até 12× sem juros (BidPro absorve); assessoria R$ 5 mil à vista ou R$ 6 mil em até 12× sem juros; e-book à vista; curso à vista ou até 12× sem juros; honorário à vista (Pix, boleto, cartão 1×) sem juros e 2–12× com juros ao cliente; taxa de serviço de registro à vista sem juros e parcelado com juros ao cliente; cobrança avulsa: quem gera escolhe absorver ou repassar.',
 array['politica_parcelamento'], true)
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao, aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();

create or replace function public.politica_parcelamento(p_produto text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_produto is null then valor else valor -> p_produto end
    from public.regra_negocio where chave = 'pagamento.parcelamento_por_produto' and ativo;
$$;
grant execute on function public.politica_parcelamento(text) to authenticated, service_role;
