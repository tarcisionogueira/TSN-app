-- 20/10 (decisão do dono): o custo da desocupação são os honorários de 10%, divididos pela equipe
-- conforme Admin → honorários. O campo manual saiu do checklist jurídico do Caso (b7e8421) e a
-- coluna estava vazia (0 de 0 linhas). Aplicada pelo dono no SQL Editor em 20/10.
alter table public.analise_juridica drop column if exists custo_desocupacao_est;
