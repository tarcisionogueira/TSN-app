-- MONITORAR OS DOIS SERVIDORES (Supabase + backup off-region) no check-up de saúde.
--
-- Hoje o `backup-r2-cron` roda, devolve JSON para quem chamou... e não deixa rastro. Se ele
-- estiver DORMENTE (sem as env do R2) ou falhando, ninguém fica sabendo — o cron responde 200
-- e o painel segue verde. Backup que ninguém verifica não é backup: é esperança. Esta tabela
-- é o rastro que faltava, e o health-check passa a lê-la.
--
-- Prevenção de catástrofe = a cópia precisa estar em REGIÃO DIFERENTE. O Supabase está em
-- sa-east-1 (São Paulo); o bucket R2 deve ser criado com "location hint" fora da América do Sul
-- (ex.: enam/weur). A região declarada vem em `regiao_destino` e o health-check acusa se ela
-- estiver vazia ou for a mesma do banco.
create table if not exists public.backup_execucoes (
  id              bigserial primary key,
  executado_em    timestamptz not null default now(),
  destino         text,                       -- ex.: 'r2:<conta>/<bucket>'
  regiao_destino  text,                       -- location hint declarado (enam/weur/apac/...)
  dormante        boolean not null default false,
  ok              boolean not null default false,
  arquivos_total  integer default 0,
  arquivos_novos  integer default 0,
  arquivos_iguais integer default 0,
  falhas          integer default 0,
  tabelas_ok      integer default 0,
  detalhe         jsonb
);

create index if not exists backup_execucoes_recentes_idx
  on public.backup_execucoes (executado_em desc);

alter table public.backup_execucoes enable row level security;
-- Sem policy: só service_role (backend) escreve e lê. Nenhum cliente precisa disso.

comment on table public.backup_execucoes is
  'Registro de cada execução do backup off-region (backup-r2-cron). Lido pelo health-check: sem registro recente = backup parado/dormente. Backup que ninguém verifica não é backup.';
