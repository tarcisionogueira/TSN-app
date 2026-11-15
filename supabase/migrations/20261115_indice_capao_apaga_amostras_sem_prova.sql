-- 15/11 (#483) — DONO AUTORIZOU NO CHAT ("pode apagar as 17 amostras de Capão da Canoa").
-- As 17 amostras do Índice de Capão da Canoa: 0 de 17 links confirmáveis (medido via pg_net em 15/11: 9 em 404 com
-- IDs sequenciais, OLX na home, Casa Linda página genérica ×5, Patrimônio sem resposta, Crédito Real em Canoas).
delete from public.indice_amostra where cidade_norm = 'capaodacanoa';
