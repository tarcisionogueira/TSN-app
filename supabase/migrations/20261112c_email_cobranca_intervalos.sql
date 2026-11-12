-- "Cobrar posição" com periodicidade livre (12/11, pedido do dono: "escolher a periodicidade").
-- Antes: só 7/15/30 dias e no máximo 5 cobranças (a tela fixava 3). Agora 2 a 30 dias e até 10 cobranças.
-- Só troca as duas CHECKs — nenhum dado muda.
alter table public.email_cobranca drop constraint if exists email_cobranca_intervalo_dias_check;
alter table public.email_cobranca add constraint email_cobranca_intervalo_dias_check check (intervalo_dias between 2 and 30);
alter table public.email_cobranca drop constraint if exists email_cobranca_max_cobrancas_check;
alter table public.email_cobranca add constraint email_cobranca_max_cobrancas_check check (max_cobrancas between 1 and 10);
