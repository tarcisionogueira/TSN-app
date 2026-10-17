-- ─────────────────────────────────────────────────────────────────────────────────────────
-- COBRAR POSIÇÃO — 17/10/2026 (pedido do dono)
--
-- Em qualquer e-mail ENVIADO pela caixa pessoal, o dono liga "Cobrar posição" (7, 15 ou 30 dias). O
-- email-cobranca-cron manda um "Re:" curto na mesma conversa, para o mesmo destinatário, até 3 vezes; para
-- sozinho quando o destinatário responde (resposta ligada pelo +token, ou do mesmo remetente com o mesmo
-- assunto), quando bate o limite (aí avisa o dono) ou quando o dono desliga. Só cobra o que o dono ligar:
-- conversa informativa segue sem cobrança (regra de 17/10).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.email_cobranca (
  id               uuid primary key default gen_random_uuid(),
  email_id         uuid not null references public.email_caixa(id) on delete cascade,
  user_id          uuid not null,
  intervalo_dias   integer not null check (intervalo_dias in (7, 15, 30)),
  max_cobrancas    integer not null default 3 check (max_cobrancas between 1 and 5),
  enviadas         integer not null default 0,
  envios           uuid[] not null default '{}',   -- ids em email_caixa das cobranças que saíram
  proxima_em       timestamptz not null,
  ativo            boolean not null default true,
  encerrado_motivo text check (encerrado_motivo in ('respondido','limite','parado','erro')),
  encerrado_em     timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create unique index if not exists email_cobranca_um_ativo_por_email on public.email_cobranca (email_id) where ativo;
create index if not exists email_cobranca_fila on public.email_cobranca (proxima_em) where ativo;

alter table public.email_cobranca enable row level security;

create policy email_cobranca_ler on public.email_cobranca for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Só liga cobrança no PRÓPRIO e-mail enviado (caixa pessoal).
create policy email_cobranca_criar on public.email_cobranca for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.email_caixa e where e.id = email_id and e.dono = (select auth.uid()) and e.direcao = 'saida'));

create policy email_cobranca_alterar on public.email_cobranca for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.email_cobranca is
  'Cobrança de posição ligada pelo dono num e-mail enviado. Lida pelo email-cobranca-cron. Ver migração 20261017_email_cobranca.sql.';
