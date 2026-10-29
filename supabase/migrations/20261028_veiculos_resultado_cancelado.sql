-- 28/10: a apuração (api/_resultado-leilao.js → patchDaApuracao) grava resultado_leilao = 'cancelado' quando a página
-- diz que o leilão foi cancelado — em imoveis_leilao (sem check) e em veiculos_leilao, cujo check só aceitava
-- vendido/sem_lance/indeterminado. O PATCH de um veículo JE cancelado caiu no 23514 e derrubou a rodada de reserva do
-- residencial (run 40787645990), deixando as fontes seguintes sem apuração. Mesmo vocabulário nas duas tabelas.
-- NOT VALID + VALIDATE: a troca só segura a tabela o instante do catálogo; a varredura vem depois, sem travar escrita.
set lock_timeout = '3s';
alter table public.veiculos_leilao drop constraint if exists veiculos_leilao_resultado_leilao_check;
alter table public.veiculos_leilao add constraint veiculos_leilao_resultado_leilao_check
  check (resultado_leilao in ('vendido','sem_lance','indeterminado','cancelado')) not valid;
alter table public.veiculos_leilao validate constraint veiculos_leilao_resultado_leilao_check;
