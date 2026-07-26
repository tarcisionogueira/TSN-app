-- Gate por fonte também para o RUNNER RESIDENCIAL (SOLEON/GESTAO/RJ) — reusa coleta_cliente:
-- garante 2x/semana por fonte, trava de 15 min (anti-overlap) e coordenação ENTRE MÁQUINAS
-- (várias máquinas/staff nunca raspam a mesma fonte ao mesmo tempo → sem bloqueio por concorrência).
-- Aplicada via MCP. O runner chama coleta_cliente_claim/concluir (service key) antes/depois de cada fonte.
insert into public.coleta_cliente (fonte) values ('SOLEON'), ('GESTAO'), ('RJ')
on conflict (fonte) do nothing;
