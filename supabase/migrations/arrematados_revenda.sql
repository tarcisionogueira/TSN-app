-- Retenção/Índice — captura da REVENDA do arrematado. A revenda é transação REAL de
-- mercado → vira amostra do Índice (com data) e gabarito para calibrar a precisão das
-- estimativas. O preço do ARREMATE (valor_arrematacao) NÃO entra no Índice.
alter table public.arrematados
  add column if not exists revenda_valor numeric,
  add column if not exists revenda_data  date,
  add column if not exists revenda_m2    numeric;
