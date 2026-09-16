-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BLOQUEIA CADASTRO COM E-MAIL DESCARTÁVEL — 16/09/2026
--
-- ACHADO: o dono viu no Admin duas contas "Testando Teste" criadas em sequência (mesmo anon_id
-- de navegador, telefones consecutivos), uma delas com e-mail de serviço de e-mail temporário
-- (@meonvr.com). Investigado: foi navegação manual de UMA pessoa clicando por todo o menu
-- público em ~10min — sem SQLi/XSS, sem tentativa de escalar privilégio, sem checkout. Risco
-- real desta ocorrência: baixo. Mas o VETOR fica aberto: `supabase.auth.signUp` é chamado
-- DIRETO do navegador (Login.jsx) — não passa por `api/_rate-limit.js` nem por CAPTCHA — então
-- nada impede repetição em escala com e-mail descartável (típico de quem não quer deixar
-- rastro: reconhecimento de concorrente, scraping de UI, ou automação futura).
--
-- ESCOPO: só bloqueia o DOMÍNIO de e-mail descartável, não é uma solução de rate-limit/CAPTCHA
-- (isso fica para decisão de UX/custo do dono — Cloudflare Turnstile é o candidato natural,
-- mas exige site key nova). Isto aqui é a correção mais barata pro vetor específico observado.
--
-- BEFORE INSERT em auth.users (não em perfis): bloqueia na ORIGEM, antes do handle_new_user()
-- rodar — não dá pra confiar em checagem client-side sozinha, porque qualquer um pode chamar
-- a API do GoTrue direto (mesma lição de todo o resto desta base: validação de UI é
-- conveniência, a trava real mora no banco).
--
-- Lista curta e de manutenção simples — não é exaustiva (não existe lista exaustiva de e-mail
-- temporário; novos serviços nascem toda semana). O objetivo é subir o custo de quem repete
-- este padrão exato, não blindar 100% dos casos.
create table if not exists public.dominios_email_bloqueados (
  dominio text primary key,
  motivo text not null default 'email descartavel',
  criado_em timestamptz not null default now()
);

comment on table public.dominios_email_bloqueados is
  'Domínios de e-mail recusados no cadastro (BEFORE INSERT em auth.users). Achado em 16/09: conta de teste com e-mail descartável navegando por todo o site. Editável sem migração — INSERT/DELETE direto na tabela.';

insert into public.dominios_email_bloqueados (dominio, motivo) values
  ('meonvr.com', 'usado na conta de teste que originou este bloqueio (16/09)'),
  ('mailinator.com', 'servico publico de e-mail temporario'),
  ('guerrillamail.com', 'servico publico de e-mail temporario'),
  ('sharklasers.com', 'alias do guerrillamail'),
  ('10minutemail.com', 'servico publico de e-mail temporario'),
  ('temp-mail.org', 'servico publico de e-mail temporario'),
  ('tempmail.com', 'servico publico de e-mail temporario'),
  ('yopmail.com', 'servico publico de e-mail temporario'),
  ('trashmail.com', 'servico publico de e-mail temporario'),
  ('throwawaymail.com', 'servico publico de e-mail temporario'),
  ('getnada.com', 'servico publico de e-mail temporario'),
  ('dispostable.com', 'servico publico de e-mail temporario'),
  ('maildrop.cc', 'servico publico de e-mail temporario'),
  ('discard.email', 'servico publico de e-mail temporario'),
  ('fakeinbox.com', 'servico publico de e-mail temporario'),
  ('mohmal.com', 'servico publico de e-mail temporario')
on conflict (dominio) do nothing;

alter table public.dominios_email_bloqueados enable row level security;
revoke all on public.dominios_email_bloqueados from public, anon, authenticated;
grant select on public.dominios_email_bloqueados to service_role;

create or replace function public.bloquear_email_descartavel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dominio text;
begin
  v_dominio := lower(split_part(new.email, '@', 2));
  if v_dominio <> '' and exists (
    select 1 from public.dominios_email_bloqueados d where d.dominio = v_dominio
  ) then
    raise exception 'dominio_email_bloqueado: % nao e aceito para cadastro', v_dominio
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.bloquear_email_descartavel() is
  'BEFORE INSERT em auth.users — recusa cadastro com dominio de e-mail descartavel (ver dominios_email_bloqueados). Mensagem "dominio_email_bloqueado" e traduzida em src/lib/erroAuth.js.';

drop trigger if exists trg_bloquear_email_descartavel on auth.users;
create trigger trg_bloquear_email_descartavel
  before insert on auth.users
  for each row execute function public.bloquear_email_descartavel();
