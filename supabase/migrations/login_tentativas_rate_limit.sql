-- Achado do QA de 21/09: login era o único fluxo de auth sem NENHUMA fricção própria (nem
-- Turnstile, nem rate-limit da aplicação) — só o limite genérico do GoTrue, pensado para
-- abuso de infra, não para travar tentativa de senha contra UMA conta específica
-- (credential-stuffing, possivelmente rotacionando IP). Mesmo padrão de `verificar_cpf_rate`
-- (RLS ligado, zero política — só service_role acessa, via api/login-rate.js).
create table if not exists public.login_tentativas (
  id bigint generated always as identity primary key,
  email text not null,
  criado_em timestamptz not null default now()
);
create index if not exists login_tentativas_email_criado_em_idx
  on public.login_tentativas (email, criado_em);

alter table public.login_tentativas enable row level security;
