-- Confirmação de leitura de e-mail (pedido do dono): registra entrega/abertura/clique a partir
-- dos webhooks do Resend, para o Cliente 360 mostrar se o e-mail foi lido. Só metadados.
alter table public.emails_log add column if not exists entregue_em timestamptz; -- email.delivered
alter table public.emails_log add column if not exists aberto_em   timestamptz; -- email.opened (1ª abertura)
alter table public.emails_log add column if not exists clicado_em  timestamptz; -- email.clicked
create index if not exists idx_emails_log_resend on public.emails_log(resend_id);
