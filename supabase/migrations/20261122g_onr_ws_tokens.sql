-- Web Service OFICIAL da ONR (WSSAEC, SOAP) — 22/11. Convênio da NOGUEIRA EMPREENDIMENTOS ativado
-- no chamado CS0819152 (IDParceiro + chave na Vercel: ONR_WS_ID / ONR_WS_CHAVE — nunca no repo).
--
-- Cada chamada se autentica com Hash = SHA1(chave + token), e cada TOKEN vale UMA vez, por 8 h.
-- O login devolve 5 de cada vez. Função serverless não tem memória entre instâncias, então o lote
-- mora aqui e é consumido com claim atômico (`for update skip locked`): duas chamadas simultâneas
-- nunca pegam o mesmo token (o 2º uso volta "Hash inválido" e parece defeito de chave).

create table if not exists public.onr_ws_tokens (
  token      text primary key,
  ambiente   text not null,                      -- base URL: token de homologação não vale em produção
  gerado_em  timestamptz not null default now(),
  usado_em   timestamptz
);
create index if not exists onr_ws_tokens_livres on public.onr_ws_tokens (ambiente, gerado_em) where usado_em is null;
alter table public.onr_ws_tokens enable row level security;

-- Rastro de toda chamada (auditoria + custo): o que foi pedido, quanto custou, o que a ONR respondeu.
create table if not exists public.onr_ws_chamadas (
  id          bigint generated always as identity primary key,
  ambiente    text not null,
  servico     text not null,
  metodo      text not null,
  ok          boolean not null,
  codigo_erro int,
  erro        text,
  protocolo   text,
  valor_total numeric,
  ms          int,
  user_id     uuid,
  criado_em   timestamptz not null default now()
);
create index if not exists onr_ws_chamadas_recentes on public.onr_ws_chamadas (criado_em desc);
alter table public.onr_ws_chamadas enable row level security;

-- Pega UM token livre e válido (< 7h30 de idade: margem antes das 8 h) e já o marca como usado.
create or replace function public.onr_ws_token_pegar(p_ambiente text)
returns text language plpgsql security invoker set search_path = public as $$
declare t text;
begin
  select token into t from public.onr_ws_tokens
   where ambiente = p_ambiente and usado_em is null and gerado_em > now() - interval '7 hours 30 minutes'
   order by gerado_em
   limit 1
   for update skip locked;
  if t is not null then
    update public.onr_ws_tokens set usado_em = now() where token = t;
  end if;
  return t;
end $$;
-- SECURITY INVOKER de propósito: quem chama com a service key passa; anon/authenticated batem na RLS
-- (sem política) e recebem null — sem precisar de revoke.
