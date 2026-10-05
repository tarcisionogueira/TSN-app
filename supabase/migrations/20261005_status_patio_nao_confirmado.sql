-- PÁTIO NÃO CONFIRMADO (dono, 05/10 — "opção 2, com selo"): veículo com local de vistoria/visitação informado e
-- SEM sinal de devedor passa a aparecer na busca, com o selo "Pátio não confirmado". Classificador único:
-- scripts/lib/patio-veiculo.mjs. 'indefinido' (nada, ou "em mãos de" uma pessoa) continua fora da busca;
-- 'excluido' (com o executado/devedor) continua nunca gravado.
set local lock_timeout = '8s';
alter table public.veiculos_leilao drop constraint if exists veiculos_leilao_status_patio_check;
alter table public.veiculos_leilao add constraint veiculos_leilao_status_patio_check
  check (status_patio in ('confirmado','nao_confirmado','indefinido','excluido'));
