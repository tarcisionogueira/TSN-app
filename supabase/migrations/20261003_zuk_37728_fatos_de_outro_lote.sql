-- 03/10 — REGISTRO de correção de dados já aplicada (idempotente).
-- Leilão ZUK 37728: o edital (um PDF para 4 lotes) lista "LOTE 001⏎MATRÍCULA 7513…" sem pontuação
-- depois do número, e ehDocMultiLote não reconhecia essa enumeração → a matrícula e a identidade do
-- LOTE 001 (Edifício Britania, Jaboatão/PE) foram gravadas nos 4 lotes (Campina Grande/PB e 2 em
-- Fortaleza/CE). Achado pelo invariante matricula_area_de_outro_lote. Conserto de código em
-- api/_edital-extrato.js (ehDocMultiLote aceita "LOTE N" sozinho na linha). Nenhum relatório gerado
-- para os 3 lotes afetados.
-- Fortaleza (2): sem matrícula/identidade (vazio é melhor que errado).
update imoveis_leilao set doc_fatos = doc_fatos - 'matricula' - 'identidade'
 where id in ('e41d5d83-20c6-4bd6-819a-7c45d346e5c5','37537bf0-d51e-42bb-a87e-f18726a8de28')
   and doc_fatos->'matricula'->>'numeroMatricula' = '7513';
-- Campina Grande: fatos da PRÓPRIA matrícula (10359), conferidos no texto da certidão.
update imoveis_leilao set doc_fatos = doc_fatos
     || jsonb_build_object('matricula', jsonb_build_object('numeroMatricula','10359','areaTotalM2',226.8),
                           'identidade', jsonb_build_object('logradouro','Rua Pedro Leal','bairro','Liberdade'))
 where id = '52e62f78-72b2-4fc6-b97f-73aa7baef2d9' and doc_fatos->'matricula'->>'numeroMatricula' = '7513';
