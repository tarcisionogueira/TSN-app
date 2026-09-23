-- 23/09 — `extrairDatasLeilao` lia a página INTEIRA do lote, inclusive a vitrine "Veja também"
-- com OUTROS lotes, e gravava as datas deles como 2ª praça (ZUK Alameda dos Lírios 196: prazo
-- 05/10 de um apartamento de Barueri num lote que encerra 29/09). Corrigido em
-- api/enriquecer-lote.js (cortarOutrosLotes). Aqui: zera a 2ª praça gravada pelo extrator
-- genérico nas fontes em que ela é suspeita (horários quebrados de fechamento escalonado,
-- sem lance de 2ª praça) e devolve o lote à fila de enriquecimento, que relê com o extrator
-- corrigido. MEGA/SUPORTE (2ª praça do próprio coletor), CEF, EDITAL_DJEN e TORRES3/WEBLEILOES/
-- DANIELGARCIA (padrão coerente de 2ª praça do leilão) ficam como estão.
update imoveis_leilao set data_leilao_2 = null, enriquecido_em = null
where ativo and data_leilao_2 is not null and fonte in ('ZUK','GRUPOLANCE','FRAZAO','LEFFA','LJUD','BIASI');
