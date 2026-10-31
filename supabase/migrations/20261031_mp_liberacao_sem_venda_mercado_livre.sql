-- 31/10 (abertura): `mp_liberacao_atrasada` (crítico) = 1. O pagamento era "Cloro P/ Limpeza De Piscina"
-- (R$ 139, sem user_id) com `dados_mp.order.type = 'mercadolibre'`: VENDA do Mercado Livre que passou pela
-- mesma conta do Mercado Pago. Liberação em 28 dias é a regra do Mercado Livre (após a entrega), não atraso
-- de cobrança do BidPro. O invariante contava todo pagamento aprovado da conta; agora ignora pedido do ML.
-- Troca só o trecho (a função tem ~37 KB); falha se o trecho não estiver lá exatamente uma vez.
do $mig$
declare
  d text := pg_get_functiondef('public.qa_invariantes'::regproc);
  velho constant text := $t$(select count(*) from mp_pagamentos where status='approved' and coalesce(dados_mp->>'payment_type_id','') <> 'ticket'$t$;
  novo  constant text := $t$(select count(*) from mp_pagamentos where status='approved' and coalesce(dados_mp->'order'->>'type','') <> 'mercadolibre' and coalesce(dados_mp->>'payment_type_id','') <> 'ticket'$t$;
begin
  if (length(d) - length(replace(d, velho, ''))) / length(velho) <> 1 then
    raise exception 'qa_invariantes: trecho de mp_liberacao_atrasada não encontrado exatamente 1 vez';
  end if;
  execute replace(d, velho, novo);
end
$mig$;
