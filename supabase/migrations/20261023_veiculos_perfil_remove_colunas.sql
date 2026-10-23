-- 23/10: colunas das perguntas descartadas pelo dono (sinistro/sucata, ano mínimo, finalidade). Vazias e sem
-- uso no código. Removidas pelo dono no SQL Editor (o conector MCP exige a confirmação dele para DROP);
-- este arquivo só registra o estado do banco para quem recriar a partir de supabase/migrations/.
alter table public.perfis drop column if exists veiculo_condicao;
alter table public.perfis drop column if exists veiculo_ano_min;
alter table public.perfis drop column if exists veiculo_finalidade;
