-- Leads vindos da página de lançamento na Homio (11/11, pedido do dono: lançamento de 26/11).
--
-- Quem se inscreve na página da Homio ganha uma conta Explorador aqui, criada na hora pela rota
-- `api/homio-lead.js`. A conta nasce com senha aleatória e SEM o aceite dos termos: o acesso só
-- abre pelo link de ativação mandado ao e-mail (prova de posse do endereço, a mesma régua de #251),
-- e o aceite dos termos é pedido pelo popup de cadastro incompleto no primeiro acesso.
--
-- Esta tabela é o RASTRO de cada inscrição: o que chegou, o que foi feito com ela, se o e-mail de
-- ativação saiu, se a pessoa ativou e se a Homio foi avisada. Sem ela, "inscrito sem conta" e
-- "conta sem e-mail de ativação" seriam invisíveis — o vazio entregue como resposta.
--
-- Só o servidor (service role) lê e escreve: RLS ligada e nenhuma política para anon/authenticated.

create table if not exists public.homio_leads (
  id                     uuid primary key default gen_random_uuid(),
  recebido_em            timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),
  campanha               text not null default 'lancamento',
  email                  text not null,
  nome                   text,
  telefone               text,
  homio_contact_id       text,
  utm                    jsonb not null default '{}'::jsonb,
  payload                jsonb,
  -- recebido → conta_criada | ja_tinha_conta | erro
  situacao               text not null default 'recebido'
                         check (situacao in ('recebido', 'conta_criada', 'ja_tinha_conta', 'erro')),
  user_id                uuid,
  conta_nova             boolean not null default false,
  erro                   text,
  -- link de ativação: só o HASH fica no banco; o token cru vai no e-mail e no aviso à Homio
  token_hash             text unique,
  token_expira_em        timestamptz,
  email_ativacao_em      timestamptz,
  email_ativacao_erro    text,
  ativado_em             timestamptz,
  -- avisos à Homio (webhook de entrada configurado em HOMIO_WEBHOOK_URL)
  homio_avisado          jsonb not null default '{}'::jsonb,   -- { "conta_criada": "<iso>", "conta_ativada": "<iso>" }
  homio_aviso_pendente   text[] not null default '{}',          -- eventos que falharam e o cron reenvia
  homio_aviso_tentativas integer not null default 0,
  homio_aviso_erro       text,
  constraint homio_leads_email_campanha_unico unique (email, campanha)
);

create index if not exists homio_leads_pendentes_idx
  on public.homio_leads (recebido_em)
  where cardinality(homio_aviso_pendente) > 0 or (situacao = 'conta_criada' and email_ativacao_em is null);

create index if not exists homio_leads_user_idx on public.homio_leads (user_id) where user_id is not null;

-- RLS ligada e nenhuma política: anon/authenticated não enxergam linha nenhuma; o service role passa.
alter table public.homio_leads enable row level security;

comment on table public.homio_leads is
  'Inscrições da página de lançamento na Homio → conta Explorador pendente de ativação (api/homio-lead.js, api/ativar-conta.js, api/homio-reenvio-cron.js).';

-- Resumo para o health-check e para a sessão: o que está parado em cada etapa.
create or replace function public.homio_leads_resumo(p_horas integer default 72)
returns jsonb
language sql
stable
security invoker   -- de propósito: chamada por anon/authenticated esbarra na RLS e conta zero; o service role lê tudo
set search_path = public
as $$
  select jsonb_build_object(
    'recebidos',            count(*),
    'contas_criadas',       count(*) filter (where situacao = 'conta_criada'),
    'ja_tinham_conta',      count(*) filter (where situacao = 'ja_tinha_conta'),
    'erros',                count(*) filter (where situacao = 'erro'),
    'ativadas',             count(*) filter (where ativado_em is not null),
    'sem_email_ativacao_1h', count(*) filter (where situacao = 'conta_criada' and email_ativacao_em is null
                                              and recebido_em < now() - interval '1 hour'),
    'aviso_homio_pendente', count(*) filter (where cardinality(homio_aviso_pendente) > 0),
    'ultimo_erro',          (select erro from public.homio_leads e
                              where e.situacao = 'erro' and e.recebido_em > now() - make_interval(hours => p_horas)
                              order by e.recebido_em desc limit 1)
  )
  from public.homio_leads
  where recebido_em > now() - make_interval(hours => p_horas);
$$;
