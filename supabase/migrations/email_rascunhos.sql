-- Rascunhos da caixa de e-mail da equipe (pedido do dono, 24/09: "permitir criar rascunho caso
-- precise começar a escrever e pausar"). Salvo sozinho enquanto se escreve (CaixaEmail.jsx);
-- apagado quando o e-mail é enviado. Privado de quem escreveu — nem o admin lê o rascunho alheio.
create table if not exists public.email_rascunhos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.perfis(id) on delete cascade default auth.uid(),
  de           text,
  para         text,
  cc           text,
  assunto      text,
  texto        text,
  responder_a  uuid references public.email_caixa(id) on delete set null,
  chamado_id   uuid,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists email_rascunhos_user_idx on public.email_rascunhos (user_id, atualizado_em desc);
create index if not exists email_rascunhos_responder_a_idx on public.email_rascunhos (responder_a);
alter table public.email_rascunhos enable row level security;
drop policy if exists email_rascunhos_dono on public.email_rascunhos;
create policy email_rascunhos_dono on public.email_rascunhos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.email_rascunhos from anon;
grant select, insert, update, delete on public.email_rascunhos to authenticated;
