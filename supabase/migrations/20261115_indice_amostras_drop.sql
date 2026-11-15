-- 15/11 — RODADO PELO DONO no SQL Editor (DROP fica com o dono). A tabela antiga do Índice (`indice_amostras`, plural)
-- estava congelada desde 20261115_indice_corpus_unico: nada lia nem gravava. Conferido depois: to_regclass nulo,
-- nenhuma função citando, ponderado/composição/regiões respondendo, auditoria_seguranca total 0.
revoke insert, update, delete on public.indice_amostras from anon, authenticated, service_role;
drop table public.indice_amostras;
