-- 12/10: `mp_liberacao_atrasada` (crítico) acusava um BOLETO Bradesco de R$ 1.000 aprovado em 07/10 e
-- liberado em 10/10. Boleto (payment_type_id = 'ticket') sempre libera em D+2/D+3 úteis — o padrão de
-- "0h" do achado de 21/09 vale para cartão/PIX. Forma nº 10: media boleto com a régua de cartão.
-- Troca só o predicado do invariante, preservando o resto da função como está no banco.
do $$
declare
  d text := pg_get_functiondef('public.qa_invariantes'::regproc);
  velho text := $v$(select count(*) from mp_pagamentos where status='approved' and dados_mp ? 'money_release_date'$v$;
  novo  text := $v$(select count(*) from mp_pagamentos where status='approved' and coalesce(dados_mp->>'payment_type_id','') <> 'ticket' and coalesce(dados_mp->>'payment_method_id','') !~ '^bol' and dados_mp ? 'money_release_date'$v$;
begin
  if position(novo in d) > 0 then return; end if;            -- já aplicada
  if position(velho in d) = 0 then raise exception 'trecho do mp_liberacao_atrasada não encontrado'; end if;
  execute replace(d, velho, novo);
end $$;
