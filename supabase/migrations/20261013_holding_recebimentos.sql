-- 13/10 (dono): ENTRADAS das contas bancárias da empresa, lidas da holding pelo contrato
-- `/api/externo/recebimentos` (repositório holding-nogueira). Cópia SÓ DE LEITURA para conferir
-- honorários e recebimentos fora dos gateways — NÃO entra em conciliacao_lancamento/DRE (a saída
-- do Mercado Pago para o banco contaria duas vezes). Os sistemas seguem independentes: sem a holding,
-- esta tabela só para de crescer. Escrita só pelo servidor (api/holding-recebimentos-cron.js).
create table if not exists public.holding_recebimentos (
  id text primary key,                 -- id opaco e estável do contrato da holding
  data date not null,
  valor numeric(14,2) not null check (valor > 0),
  descricao text not null default '',
  instituicao text not null default '',
  conta text not null default '',
  vinculo_tipo text,                   -- ex.: 'honorarios' (preenchido na conferência)
  vinculo_id text,                     -- ex.: arrematacoes.id
  lido_em timestamptz not null default now()
);
create index if not exists holding_recebimentos_data_idx on public.holding_recebimentos (data desc);

alter table public.holding_recebimentos enable row level security;
drop policy if exists holding_recebimentos_admin_le on public.holding_recebimentos;
create policy holding_recebimentos_admin_le on public.holding_recebimentos for select to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
revoke insert, update, delete on public.holding_recebimentos from anon, authenticated;
