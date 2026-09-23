-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CAIXA DE E-MAIL DA EQUIPE dentro de /atendimento — 23/09/2026 (pedido do dono)
--
-- "Na tela Atendimento, para mim e equipe: caixa de entrada, redigir e-mails e spam (e-mail
-- classificado como inseguro), com opção de bloquear remetente."
--
-- O que já existia e continua igual: `api/inbound-juridico.js` recebe o `email.received` do
-- Resend e transforma o que chega em suporte@/contato@/privacidade@ em CHAMADO (ou devolutiva
-- do jurídico). O chamado é o fluxo de atendimento; a caixa é o REGISTRO de todo e-mail que
-- entrou ou saiu — inclusive o que não vira chamado (spam, bloqueado, rate-limit).
--
--   email_caixa       uma linha por mensagem (entrada e saída). `pasta` é onde ela aparece:
--                     entrada | spam | enviados | lixeira. `chamado_id` liga ao chamado que
--                     ela abriu/alimentou, quando houver.
--   email_bloqueados  endereço (fulano@x.com) ou domínio (@x.com). Quem casa aqui cai direto
--                     em spam e NÃO abre chamado.
--
-- Acesso: admin + funções de equipe analista/consultor (`pode_caixa_email()`). Advogado fica
-- de fora — a caixa mistura privacidade@ (pedido LGPD) e devolutivas de outros casos.
-- Escrita de mensagem é só do servidor (service_role); a equipe só move pasta / marca lido.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.pode_caixa_email()
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_funcao('admin') or public.eh_funcao('analista') or public.eh_funcao('consultor');
$$;
revoke execute on function public.pode_caixa_email() from public, anon;
grant execute on function public.pode_caixa_email() to authenticated, service_role;

create table if not exists public.email_caixa (
  id              uuid primary key default gen_random_uuid(),
  direcao         text not null check (direcao in ('entrada','saida')),
  pasta           text not null default 'entrada' check (pasta in ('entrada','spam','enviados','lixeira')),
  caixa           text,                 -- endereço nosso envolvido (suporte@, contato@…)
  de_email        text,
  de_nome         text,
  para            text[] not null default '{}',
  cc              text[] not null default '{}',
  assunto         text,
  texto           text,
  html            text,
  message_id      text,
  in_reply_to     text,
  referencias     text,
  resend_email_id text,                 -- id do Resend (recebido: baixa anexo sob demanda)
  anexos          jsonb not null default '[]'::jsonb,  -- [{id, nome, content_type, tamanho}]
  autenticacao    jsonb,                -- {spf, dkim, dmarc} lidos do Authentication-Results
  spam_motivo     text,
  lido            boolean not null default false,
  chamado_id      uuid references public.chamados(id) on delete set null,
  enviado_por     uuid references public.perfis(id) on delete set null,
  criado_em       timestamptz not null default now()
);
-- Dedup do webhook (o Resend reentrega): mesma mensagem, mesma direção, uma linha só.
create unique index if not exists email_caixa_msgid_uq on public.email_caixa (direcao, message_id) where message_id is not null;
create index if not exists email_caixa_pasta_idx on public.email_caixa (pasta, criado_em desc);
create index if not exists email_caixa_chamado_idx on public.email_caixa (chamado_id) where chamado_id is not null;
create index if not exists email_caixa_enviado_por_idx on public.email_caixa (enviado_por) where enviado_por is not null;

create table if not exists public.email_bloqueados (
  id         uuid primary key default gen_random_uuid(),
  padrao     text not null unique check (padrao ~ '^([^@\s]+@[^@\s]+\.[^@\s]+|@[^@\s]+\.[^@\s]+)$'),
  motivo     text,
  criado_por uuid references public.perfis(id) on delete set null,
  criado_em  timestamptz not null default now()
);
create index if not exists email_bloqueados_criado_por_idx on public.email_bloqueados (criado_por) where criado_por is not null;

-- Decisão ÚNICA de bloqueio (o webhook e a tela perguntam a mesma coisa ao mesmo lugar).
create or replace function public.email_remetente_bloqueado(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.email_bloqueados b
     where b.padrao = lower(trim(p_email))
        or b.padrao = '@' || split_part(lower(trim(p_email)), '@', 2)
  );
$$;
revoke execute on function public.email_remetente_bloqueado(text) from public, anon;
grant execute on function public.email_remetente_bloqueado(text) to authenticated, service_role;

alter table public.email_caixa enable row level security;
alter table public.email_bloqueados enable row level security;

drop policy if exists email_caixa_equipe_le on public.email_caixa;
create policy email_caixa_equipe_le on public.email_caixa
  for select to authenticated using ((select public.pode_caixa_email()));
drop policy if exists email_caixa_equipe_move on public.email_caixa;
create policy email_caixa_equipe_move on public.email_caixa
  for update to authenticated using ((select public.pode_caixa_email())) with check ((select public.pode_caixa_email()));

drop policy if exists email_bloqueados_equipe on public.email_bloqueados;
create policy email_bloqueados_equipe on public.email_bloqueados
  for all to authenticated using ((select public.pode_caixa_email())) with check ((select public.pode_caixa_email()));

-- A equipe só mexe em pasta/lido pela tela; conteúdo é do servidor. Grant por coluna fecha o
-- resto mesmo com a policy de UPDATE aberta à equipe.
revoke all on public.email_caixa from anon, authenticated;
grant select on public.email_caixa to authenticated;
grant update (pasta, lido) on public.email_caixa to authenticated;
revoke all on public.email_bloqueados from anon, authenticated;
grant select, insert, delete on public.email_bloqueados to authenticated;
