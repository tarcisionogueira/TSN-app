-- 23/10 (decisão do dono, revisão do mesmo dia): o questionário de veículos passa a ser
--   1) interesse sim/não · 2) tipos (múltipla escolha) · 3) valor médio de FIPE (até 50/100/150 mil ou acima).
-- A localização NÃO entra: leilão de pátio, o comprador paga só o frete. A pergunta de finalidade
-- (usar/revender/recuperar) saiu da tela até o dono aprovar; a coluna veiculo_finalidade fica, sem uso.
-- Ninguém tinha respondido a versão anterior (0 linhas), então trocar o check não perde dado.
alter table public.perfis drop constraint perfis_interesse_veiculos_check;
alter table public.perfis add constraint perfis_interesse_veiculos_check check (interesse_veiculos in ('sim', 'nao'));
alter table public.perfis add column if not exists veiculo_tipos text[]
  check (veiculo_tipos <@ array['carro','moto','caminhao','van_utilitario','onibus','maquina']::text[]);
alter table public.perfis add column if not exists veiculo_faixa_fipe text
  check (veiculo_faixa_fipe in ('ate_50k', 'ate_100k', 'ate_150k', 'acima_150k'));
