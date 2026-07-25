-- 2ª PRAÇA da Caixa (leilão SFI/extrajudicial): o CSV traz só o valor da 1ª praça
-- (≈ avaliação) e a data mais próxima. A 2ª praça — quase sempre a OPORTUNIDADE real
-- (ex.: 1ª R$ 550k = avaliação, 2ª R$ 330k = 40% abaixo) — só existe na página de
-- detalhe e era descartada. Estas colunas guardam o valor e a data da 2ª praça,
-- capturados pelo enriquecedor (scripts/enriquecer-datas-cef.mjs) na MESMA visita que
-- já pega data/edital/ficha (sem custo extra). A 1ª praça continua em valor_minimo /
-- data_leilao; desconto_percentual segue calculado sobre a 1ª (não muda ranking).
alter table public.imoveis_leilao
  add column if not exists valor_minimo_2 numeric,
  add column if not exists data_leilao_2  timestamptz;
