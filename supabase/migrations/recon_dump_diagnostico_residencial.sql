-- 23/09 — Depósito de diagnóstico do runner residencial. O dono roda recon na máquina de casa
-- e a saída (JSON cru de API de leiloeiro) é longa demais para print de tela. O script grava
-- aqui e a sessão lê do banco. Só service key: RLS ligada e NENHUMA política.
create table if not exists public.recon_dump (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  origem text not null,
  chave text,
  conteudo jsonb not null
);
alter table public.recon_dump enable row level security;
revoke all on public.recon_dump from anon, authenticated;
