-- 10/10 (correção de dado, já aplicada): 3 lotes LEJE vivos gravados com ano 2020 pelo bug do
-- parser (corrigido em 97d9bec) e expirados na hora. Datas reais lidas na página do lote.
-- Nulo NÃO servia: o trigger preservar_data_leilao devolve a data antiga quando a nova vem nula.
update imoveis_leilao set data_leilao = '2026-10-15T13:40:00-03:00', ativo = true
 where fonte = 'LEJE' and fonte_id in ('leje_18829','leje_18830') and data_leilao like '2020-%';
update imoveis_leilao set data_leilao = '2026-10-14T13:40:00-03:00', ativo = true
 where fonte = 'LEJE' and fonte_id = 'leje_19028' and data_leilao like '2020-%';
