-- 23/10: estas duas colunas foram criadas para perguntas (sinistro/sucata e ano mínimo) que o dono
-- DESCARTOU no mesmo dia ("as pessoas se importam mais com o valor da FIPE"). Ficam no banco, VAZIAS e
-- sem uso no código, até o dono rodar a remoção (o conector MCP exige confirmação dele para DROP):
--   alter table public.perfis drop column if exists veiculo_condicao;
--   alter table public.perfis drop column if exists veiculo_ano_min;
-- (veiculo_finalidade, da migração 20261023_veiculos_no_perfil_e_email.sql, também está sem uso.)
alter table public.perfis add column if not exists veiculo_condicao text
  check (veiculo_condicao in ('so_bom', 'sinistro_ok', 'sucata_ok'));
alter table public.perfis add column if not exists veiculo_ano_min text
  check (veiculo_ano_min in ('qualquer', '2015', '2020'));
