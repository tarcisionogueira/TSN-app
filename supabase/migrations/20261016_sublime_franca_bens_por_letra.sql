-- matricula_area_de_outro_lote (16/10): 3 lotes SUBLIME do mesmo edital (5ª Vara Cível de Franca,
-- proc. 1017936-15.2023.8.26.0196) com fatos de matrícula CRUZADOS. O edital enumera os bens por
-- LETRA — "(A) – PRÉDIO RESIDENCIAL ... MATRÍCULA Nº 15.839" e "(B) – GLEBA DE TERRAS ... MATRÍCULA
-- Nº 17.677" — e ehDocMultiLote só conhecia "Lote N" ou 3+ matrículas: o edital passou como lote
-- único. Pior: isolarBlocoDoLote usou "lote 04 da quadra 17"/"lote 06" (endereço da casa) como
-- fronteira e devolveu um bloco com os dois bens, que a captura tratou como isolado.
-- Resultado: a casa ficou com o número da gleba; a gleba (10,55 ha) com 250 m² e o endereço da casa;
-- o lote principal (A+B) com a matrícula da casa. Conserto de código em api/_edital-extrato.js
-- (5ª forma: bens por letra) + teste. Conferido no texto do edital e da matrícula 17.677 (16/10).
-- Nenhum relatório gerado para os 3.
update imoveis_leilao
   set doc_fatos = doc_fatos
     || jsonb_build_object('matricula', jsonb_build_object('numeroMatricula', '15839', 'areaTerrenoM2', 250),
                           'identidade', jsonb_build_object('logradouro', 'Rua Raul Montes Torres'))
 where id = 'b66b7da3-2da2-446c-a3af-ba5986894f17' and doc_fatos->'matricula'->>'numeroMatricula' = '17677';
-- Gleba: 10,55,00 ha = 105.500 m² (matrícula 17.677, ficha 01).
update imoveis_leilao
   set doc_fatos = doc_fatos
     || jsonb_build_object('matricula', jsonb_build_object('numeroMatricula', '17677', 'areaTerrenoM2', 105500),
                           'identidade', jsonb_build_object('logradouro', 'Estrada Vicinal Ribeirão Corrente'))
 where id = '5108e3dc-7f7c-45ff-8643-142c34b2bc7e' and (doc_fatos->'matricula'->>'areaTerrenoM2')::numeric = 250;
-- Lote principal (A+B juntos): nenhuma matrícula única descreve o lote — vazio é melhor que errado.
update imoveis_leilao set doc_fatos = doc_fatos - 'matricula' - 'identidade'
 where id = '6ff1d5a7-7dbe-4644-957f-6748cb00cffd' and doc_fatos->'matricula'->>'numeroMatricula' = '15839';
