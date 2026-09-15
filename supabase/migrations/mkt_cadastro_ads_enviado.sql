-- Evita reenviar a conversão OFFLINE de Cadastro ao Google Ads a cada novo login. O
-- endpoint POST /api/marketing-confirmar-cadastro roda no SIGNED_IN (depois de
-- registrar_marketing gravar perfis.mkt_gclid) e faz um UPDATE ... WHERE
-- mkt_cadastro_ads_enviado = false — só quem MUDOU a linha manda o evento pro Google, então
-- uma corrida entre duas abas (ou logins repetidos) nunca duplica o envio.
alter table public.perfis
  add column if not exists mkt_cadastro_ads_enviado boolean not null default false;

comment on column public.perfis.mkt_cadastro_ads_enviado is
  'true depois da 1a tentativa de mandar a conversao offline de Cadastro ao Google Ads (enviada ou pulada por falta de gclid). Trava de idempotencia — nao reenviar a cada login.';
