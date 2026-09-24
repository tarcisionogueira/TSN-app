-- WhatsApp OFICIAL (Cloud API da Meta) — atendimento RECEPTIVO com IA (pedido do dono, 24/09).
-- Mesmo desenho do Instagram: o webhook só GRAVA (a Meta exige 200 rápido e reentrega quando
-- demora); quem responde é api/whatsapp-responder.js. Escutar é sempre; responder depende de
-- WA_BOT_ATIVO=1 (padrão dormente). Tabelas só do servidor: RLS ligada, zero policies.
create table if not exists public.wa_conversas (
  telefone            text primary key,             -- wa_id da Meta (só dígitos, com DDI)
  nome                text,                          -- profile.name que a Meta manda
  user_id             uuid references public.perfis(id) on delete set null,
  ultima_msg_deles_em timestamptz,                   -- abre a janela de 24h de resposta grátis
  ia_pausada_ate      timestamptz,                   -- humano assumiu (escalou ou respondeu pelo app)
  escalada_em         timestamptz,
  escalada_motivo     text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create table if not exists public.wa_mensagens (
  id           bigserial primary key,
  wamid        text unique,                          -- id da Meta; UNIQUE = reentrega não duplica
  telefone     text not null references public.wa_conversas(telefone) on delete cascade,
  direcao      text not null check (direcao in ('recebida','enviada')),
  autor        text not null check (autor in ('pessoa','ia','equipe')),
  tipo         text not null default 'text',
  texto        text,
  ocorrido_em  timestamptz,
  -- ciclo da resposta (só em 'recebida'): pendente → processando (reivindicada) → respondida | ignorada | erro
  resposta_status text check (resposta_status in ('pendente','processando','respondida','ignorada','erro')),
  resposta_erro   text,
  status_entrega  text,                              -- sent/delivered/read/failed (das 'enviada')
  criado_em    timestamptz not null default now()
);
create index if not exists wa_mensagens_telefone_idx on public.wa_mensagens (telefone, criado_em desc);
create index if not exists wa_mensagens_pendentes_idx on public.wa_mensagens (criado_em) where resposta_status = 'pendente';
create index if not exists wa_conversas_user_id_idx on public.wa_conversas (user_id);

alter table public.wa_conversas enable row level security;
alter table public.wa_mensagens enable row level security;
revoke all on public.wa_conversas, public.wa_mensagens from anon, authenticated;
