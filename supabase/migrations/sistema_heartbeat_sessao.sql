-- HEARTBEAT DE ATIVIDADE — sinal de "houve sessão de trabalho recente".
--
-- Motivo (07/08): a auditoria completa do código passou a rodar SEMANAL e só deve
-- gastar quando ninguém abriu sessão. O ritual de abertura de sessão já faz a
-- checagem completa (saúde, segurança, baselines de captura), então rodar a
-- auditoria paga por cima disso é desperdício — ~R$ 43 a 59 por execução.
-- Sem um sinal registrado não há como o workflow saber se houve sessão, então
-- é isto: uma linha por chave, atualizada no início de cada sessão.
--
-- Service-only por decisão: quem lê/escreve é o backend e a GitHub Action (ambos
-- com service_role). Nenhum dado pessoal aqui — só um carimbo de tempo.
create table if not exists public.sistema_heartbeat (
  chave       text primary key,
  ultimo_em   timestamptz not null default now(),
  detalhe     text
);

alter table public.sistema_heartbeat enable row level security;
-- Sem policy = nenhum acesso via anon/authenticated. O service_role ignora RLS.
revoke all on public.sistema_heartbeat from anon, authenticated;

comment on table public.sistema_heartbeat is
  'Carimbo de atividade por chave. sessao_claude = início da última sessão de trabalho; usado pelo workflow auditoria-claude.yml para PULAR a auditoria paga quando houve sessão nos últimos 7 dias.';

-- Registra atividade (idempotente por chave). SECURITY DEFINER para a Action
-- chamar por RPC sem depender de grant de tabela.
create or replace function public.registrar_heartbeat(p_chave text, p_detalhe text default null)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.sistema_heartbeat (chave, ultimo_em, detalhe)
  values (p_chave, now(), p_detalhe)
  on conflict (chave) do update set ultimo_em = now(), detalhe = excluded.detalhe
  returning ultimo_em;
$$;

-- Só o backend/Action chamam. Sem EXECUTE para anon/authenticated: um heartbeat
-- forjado por cliente adiaria a auditoria indefinidamente.
revoke all on function public.registrar_heartbeat(text, text) from public, anon, authenticated;
grant execute on function public.registrar_heartbeat(text, text) to service_role;
