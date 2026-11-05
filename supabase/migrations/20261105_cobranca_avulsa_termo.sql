-- 05/11 (dono): cobrança avulsa com TERMO DE ACEITE antes do pagamento e parcelamento sem juros configurável.
-- Caso: assessoria para 2 imóveis, R$ 8.000 em até 12x sem juros. O cliente informa CPF/e-mail no link, completa
-- os dados, aceita o termo (texto + hash + IP gravados aqui) e só então paga. api/cobranca-avulsa-termo.js grava;
-- api/mp-checkout.js recusa pagar cobrança com termo não aceito.
alter table public.cobrancas_avulsas
  add column if not exists parcelas_sem_juros smallint not null default 1,
  add column if not exists termo_titulo text,
  add column if not exists termo_texto text,
  add column if not exists termo_aceito_em timestamptz,
  add column if not exists termo_aceite jsonb;
do $$ begin
  alter table public.cobrancas_avulsas add constraint cobrancas_avulsas_parcelas_sem_juros_ck check (parcelas_sem_juros between 1 and 12);
exception when duplicate_object then null; end $$;
comment on column public.cobrancas_avulsas.termo_aceite is 'Aceite do termo: nome, cpf, email, telefone, endereco, user_id, ip, user_agent, hash_sha256, texto_aceito, aceito_em.';
