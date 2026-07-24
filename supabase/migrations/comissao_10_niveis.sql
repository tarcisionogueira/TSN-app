-- Estende o comissionamento para 10 níveis (o dono pediu). Cauda pequena (0,5% por nível
-- 6–10) mantém o total saudável: assinatura 18,5% · produto 32,5% · venda_direta 19,5% —
-- muito abaixo da margem. A distribuição (distribuir_comissao_rede) já respeita o maior
-- nível ativo, então passa a pagar até o 10 automaticamente.
insert into public.comissao_regras (tipo, nivel, pct) values
  ('assinatura',6,0.5),('assinatura',7,0.5),('assinatura',8,0.5),('assinatura',9,0.5),('assinatura',10,0.5),
  ('produto',6,0.5),('produto',7,0.5),('produto',8,0.5),('produto',9,0.5),('produto',10,0.5),
  ('venda_direta',6,0.5),('venda_direta',7,0.5),('venda_direta',8,0.5),('venda_direta',9,0.5),('venda_direta',10,0.5)
on conflict (tipo, nivel) do nothing;
