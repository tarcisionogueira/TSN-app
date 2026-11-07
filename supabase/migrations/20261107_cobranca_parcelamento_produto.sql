-- 07/11 — Cobrança avulsa configurável (dono): produto do catálogo + quantidade (ou cobrança livre), e o
-- parcelamento de CADA negociação: até quantas parcelas e até quantas SEM juros. Padrão = o cliente assume os
-- juros a partir da 2ª parcela (parcelas_sem_juros = 1, que já era o default da coluna).
--
-- O total com juros é calculado no SERVIDOR (api/mp-checkout.js) pela mesma tabela que a tela mostra
-- (src/utils/parcelamento.js) — antes a tela mostrava juros e o servidor cobrava o saldo puro.
-- produto_key/quantidade são referência (valor e descrição pré-preenchidos, relatório); pagar a cobrança avulsa
-- não ativa plano sozinho.
alter table public.cobrancas_avulsas add column if not exists parcelas_max smallint not null default 12;
alter table public.cobrancas_avulsas add column if not exists produto_key text;
alter table public.cobrancas_avulsas add column if not exists quantidade integer not null default 1;
do $$ begin
  alter table public.cobrancas_avulsas add constraint cobrancas_avulsas_parcelas_max_ck
    check (parcelas_max between 1 and 12 and parcelas_sem_juros <= parcelas_max);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.cobrancas_avulsas add constraint cobrancas_avulsas_quantidade_ck check (quantidade between 1 and 100);
exception when duplicate_object then null; end $$;
