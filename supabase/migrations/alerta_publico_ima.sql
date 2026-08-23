-- Ímã "avise-me": captura leve de e-mail (PRÉ-CONTA) para alertas de novos imóveis por
-- cidade/UF. Tabela ISOLADA de perfis/sdr_leads — um insert forjado não fabrica lead
-- comercial nem usuário pagante. RLS LIGADA e SEM política para anon/authenticated: o
-- PostgREST anônimo não lê nem escreve; o ÚNICO escritor é o endpoint edge com a service
-- key, que valida (regex de e-mail, UF), limita por IP e usa honeypot. Duplo opt-in:
-- confirmado=false até a pessoa clicar no link do e-mail.
-- APLICADA em produção via MCP em 23/08 (retrocompatível — objeto novo).
create table if not exists public.alerta_publico (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  cidade text,
  cidade_norm text not null default '',
  uf text not null,
  filtros jsonb not null default '{}'::jsonb,
  -- token = capability aleatória (64 hex) para confirmar e descadastrar sem login/segredo.
  token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  confirmado boolean not null default false,
  confirmado_em timestamptz,
  ativo boolean not null default true,
  ultimo_envio timestamptz,
  total_enviados integer not null default 0,
  origem text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Um alerta por (e-mail, cidade, uf). cidade_norm='' cobre alerta a nível de UF.
create unique index if not exists alerta_publico_uniq on public.alerta_publico (email, cidade_norm, uf);
create index if not exists alerta_publico_match on public.alerta_publico (cidade_norm, uf) where confirmado and ativo;
create unique index if not exists alerta_publico_token on public.alerta_publico (token);

-- Dedup de envio: um imóvel nunca repete para o mesmo alerta.
create table if not exists public.alerta_publico_enviados (
  alerta_id uuid not null references public.alerta_publico(id) on delete cascade,
  imovel_id text not null,
  enviado_em timestamptz not null default now(),
  primary key (alerta_id, imovel_id)
);

alter table public.alerta_publico enable row level security;
alter table public.alerta_publico_enviados enable row level security;
-- Sem política = ninguém acessa via anon/authenticated. Só a service key (bypassa RLS).
revoke all on public.alerta_publico from anon, authenticated;
revoke all on public.alerta_publico_enviados from anon, authenticated;
