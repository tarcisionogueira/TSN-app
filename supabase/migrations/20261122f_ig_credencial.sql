-- Token do Instagram no BANCO (22/11). O `IG_PAGE_TOKEN` da Vercel venceu em 07/11 e ninguém viu:
-- todo direct teria sido recusado. Agora:
--  - o admin cola o token novo na tela /admin/instagram (validado contra a Meta antes de gravar);
--  - o cron api/ig-token-cron.js renova sozinho a cada 7 dias (o token dura ~60 e só renova vivo);
--  - api/_instagram-envio.js lê daqui primeiro e cai no IG_PAGE_TOKEN só se aqui estiver vazio.
-- Linha única. RLS sem política: só o servidor (service key) lê — o token nunca volta para a tela.
create table if not exists public.ig_credencial (
  id            int primary key default 1 check (id = 1),
  token         text not null,
  ig_user_id    text,
  username      text,
  expira_em     timestamptz,
  renovado_em   timestamptz not null default now(),
  origem        text not null default 'tela' check (origem in ('tela', 'renovacao')),
  ultimo_erro   text
);
alter table public.ig_credencial enable row level security;
