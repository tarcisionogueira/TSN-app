-- Coluna ativo em perfis (inativação de usuário)
alter table public.perfis
  add column if not exists ativo boolean not null default true;

-- Tabela de links de convite
create table if not exists public.links_convite (
  id         uuid default gen_random_uuid() primary key,
  codigo     text unique not null,
  criado_por uuid references auth.users(id) on delete cascade,
  ativo      boolean not null default true,
  usos       integer not null default 0,
  criado_em  timestamptz default now()
);

alter table public.links_convite enable row level security;

drop policy if exists "Equipe gerencia todos os convites" on public.links_convite;
create policy "Equipe gerencia todos os convites" on public.links_convite
  using (public.is_equipe())
  with check (public.is_equipe());

drop policy if exists "Usuário gerencia próprios convites" on public.links_convite;
create policy "Usuário gerencia próprios convites" on public.links_convite
  using (auth.uid() = criado_por)
  with check (auth.uid() = criado_por);

drop policy if exists "Público lê convites ativos" on public.links_convite;
create policy "Público lê convites ativos" on public.links_convite
  for select using (ativo = true);

create index if not exists idx_links_convite_codigo on public.links_convite(codigo);
create index if not exists idx_links_convite_criado_por on public.links_convite(criado_por);

-- RPC: usa um link de convite para vincular indicado_por
create or replace function public.usar_convite(p_codigo text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_criado_por uuid;
  v_link_id    uuid;
begin
  select id, criado_por into v_link_id, v_criado_por
    from public.links_convite
    where codigo = upper(p_codigo) and ativo = true
    limit 1;

  if v_criado_por is null or v_criado_por = auth.uid() then
    return false;
  end if;

  update public.perfis
    set indicado_por = v_criado_por
    where id = auth.uid() and indicado_por is null;

  update public.links_convite
    set usos = usos + 1
    where id = v_link_id;

  return found;
end;
$$;
