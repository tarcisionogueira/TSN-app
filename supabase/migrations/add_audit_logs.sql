-- Tabela de auditoria: registra ações sensíveis do sistema
create table if not exists audit_logs (
  id          bigserial primary key,
  criado_em   timestamptz not null default now(),
  acao        text        not null,
  user_id     uuid        references auth.users(id) on delete set null,
  ip          text,
  detalhes    jsonb,
  sucesso     boolean     not null default true
);

-- Índices para consultas frequentes
create index if not exists audit_logs_user_id_idx  on audit_logs(user_id);
create index if not exists audit_logs_acao_idx      on audit_logs(acao);
create index if not exists audit_logs_criado_em_idx on audit_logs(criado_em desc);

-- RLS: somente service_role lê/escreve (Claude/admin via SQL Editor)
alter table audit_logs enable row level security;

create policy "service_role_all" on audit_logs
  for all
  to service_role
  using (true)
  with check (true);
