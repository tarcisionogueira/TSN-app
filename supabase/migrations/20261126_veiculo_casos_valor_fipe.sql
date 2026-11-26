-- 26/11 (dono): painel de operações realizadas de VEÍCULOS na tela de Assessorados.
-- O "valor de avaliação" de veículo é a FIPE de referência. O caso de veículo nem sempre está
-- ligado a um lote do acervo (veiculo_id nulo — ex.: a Tracker do dono), então a FIPE mora no
-- próprio caso, editável na tela /veiculos-arrematados. Sem ela, o painel NÃO conta zero:
-- o veículo fica fora da conta do lucro e a tela diz quantos estão sem FIPE.
alter table public.veiculo_casos add column if not exists valor_fipe numeric;
comment on column public.veiculo_casos.valor_fipe is 'FIPE de referência do veículo arrematado (R$) — base do lucro bruto projetado no painel de Assessorados.';
