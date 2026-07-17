-- ERROS DE RUNTIME DO CLIENTE → SAÚDE (fecha o furo amplo do "caso Alessandra").
--
-- O front (ErrorBoundary de render + handlers globais async) reporta a
-- /api/log-erro-cliente, que PERSISTE aqui via RPC (dedup por fingerprint). A
-- verificação de saúde (api/health-check) lê a tabela e sinaliza QUALQUER quebra que
-- atinja o usuário nas últimas 24h — não só a classe RLS que o auditoria_uso() cobre.
--
-- Economia por design: 1 linha por CLASSE de erro (fingerprint = hash de msg+rota
-- normalizadas); recorrências só incrementam o contador. Escrita EXCLUSIVA do servidor
-- (service key via RPC security definer) — cliente nunca toca a tabela.
create table if not exists public.erros_cliente (
  fingerprint text primary key,          -- hash(msg normalizada + rota) — agrupa recorrências
  msg         text not null,
  rota        text,                       -- rota normalizada (#/... sem query, ids neutralizados)
  url         text,
  ua          text,
  user_id     uuid,                       -- assinante afetado, quando logado (best-effort)
  ocorrencias int  not null default 1,
  primeira_em timestamptz not null default now(),
  ultima_em   timestamptz not null default now(),
  resolvido   boolean not null default false
);
create index if not exists idx_erros_cliente_ativos on public.erros_cliente (ultima_em desc) where resolvido = false;

alter table public.erros_cliente enable row level security;
-- Leitura só admin. Escrita só service key (bypassa RLS) — sem política de cliente.
drop policy if exists erros_cliente_admin on public.erros_cliente;
create policy erros_cliente_admin on public.erros_cliente for all using (public.is_admin());

-- Cliente NÃO escreve direto (só o servidor via RPC). Revoga para não ser flagrado
-- pelo auditoria_uso() (que procura tabela com coluna de dono + INSERT do authenticated).
revoke insert, update, delete on public.erros_cliente from anon, authenticated;

comment on table public.erros_cliente is 'Erros de runtime do cliente (render + async), deduplicados por fingerprint. Alimenta a verificacao de saude para pegar QUALQUER quebra que atinja o usuario, nao so RLS.';

-- Upsert atômico com incremento (chamado pelo endpoint com service key).
create or replace function public.registrar_erro_cliente(
  p_fingerprint text, p_msg text, p_rota text default null,
  p_url text default null, p_ua text default null, p_user_id uuid default null
) returns void language sql security definer set search_path = public as $$
  insert into public.erros_cliente (fingerprint, msg, rota, url, ua, user_id)
  values (p_fingerprint, left(p_msg, 300), left(p_rota, 120), left(p_url, 300), left(p_ua, 300), p_user_id)
  on conflict (fingerprint) do update
    set ocorrencias = public.erros_cliente.ocorrencias + 1,
        ultima_em   = now(),
        msg         = excluded.msg,
        rota        = excluded.rota,
        url         = excluded.url,
        user_id     = coalesce(excluded.user_id, public.erros_cliente.user_id);
$$;
revoke all on function public.registrar_erro_cliente(text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.registrar_erro_cliente(text,text,text,text,text,uuid) to service_role;
