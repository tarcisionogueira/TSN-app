-- Histórico de e-mails enviados por destinatário (o Resend só retém por tempo
-- limitado). Alimenta o card "E-mails recebidos" do Cliente 360. Guarda apenas
-- metadados (destinatário, assunto, tipo, status) — nunca o corpo do e-mail.
create table if not exists public.emails_log (
  id           bigint generated always as identity primary key,
  user_id      uuid,
  destinatario text not null,
  assunto      text,
  tipo         text,
  status       text not null default 'enviado',
  resend_id    text,
  erro         text,
  enviado_em   timestamptz not null default now()
);

create index if not exists idx_emails_log_user     on public.emails_log (user_id, enviado_em desc);
create index if not exists idx_emails_log_dest      on public.emails_log (lower(destinatario), enviado_em desc);
create index if not exists idx_emails_log_enviado   on public.emails_log (enviado_em desc);

-- Índice único CHEIO em resend_id: no Postgres NULLs são distintos, então as linhas
-- de log ao vivo (resend_id NULL) são permitidas; só os ids do Resend ficam únicos —
-- necessário para o upsert idempotente (on_conflict=resend_id) da importação.
create unique index if not exists uq_emails_log_resend_id on public.emails_log (resend_id);

-- Só service_role escreve; leitura só via RPC SECURITY DEFINER (admin/analista).
alter table public.emails_log enable row level security;

comment on table public.emails_log is 'Histórico de e-mails enviados (metadados). Monitoramento 360 do cliente.';
