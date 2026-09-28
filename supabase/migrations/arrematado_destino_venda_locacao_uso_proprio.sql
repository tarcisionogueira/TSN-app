-- DESTINO DO IMÓVEL ARREMATADO — 28/09/2026 (pedido do dono: além de "Revendi", registrar
-- locação ou uso próprio). Venda continua em revenda_valor/revenda_data (gabarito do Índice);
-- locação grava o aluguel mensal (vira amostra `especie='locacao'` do Índice, que já existe);
-- uso próprio só marca o destino e a data — não é dado de mercado.
alter table public.arrematados add column if not exists destino text
  check (destino in ('venda', 'locacao', 'uso_proprio'));
alter table public.arrematados add column if not exists destino_data date;
alter table public.arrematados add column if not exists aluguel_valor numeric check (aluguel_valor is null or aluguel_valor > 0);
update public.arrematados set destino = 'venda', destino_data = coalesce(destino_data, revenda_data)
 where revenda_valor is not null and destino is null;
