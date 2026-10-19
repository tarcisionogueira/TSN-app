-- 19/10 (pendência 251): conta criada JÁ CONFIRMADA pelo checkout/promo/SDR sem provar posse do e-mail
-- permitia pré-sequestro (conta com o e-mail da vítima e a senha do atacante; o login com Google da vítima
-- caía nela). Agora essas rotas exigem um comprovante emitido por api/codigo-email.js depois que a pessoa
-- digita o código de 6 dígitos enviado ao e-mail. Aqui fica só o HASH do código, por e-mail.
create table if not exists public.verificacao_email_codigo (
  email text primary key,
  codigo_hash text not null,
  expira_em timestamptz not null,
  tentativas int not null default 0,
  enviado_em timestamptz not null default now()
);
alter table public.verificacao_email_codigo enable row level security;
-- Sem política: só service_role (api/codigo-email.js).
