-- Fase B.1 — Log de VISUALIZAÇÃO de imóvel (o que o cliente ABRIU, além de buscar/analisar).
-- 1 linha por (usuário, imóvel) com contador de visitas (upsert), para não inchar.
-- Acesso: escrita só via RPC registrar_imovel_visto (definer, grava para auth.uid());
-- leitura só via service_role (a tela 360º usa admin_usuario_360). RLS sem policies
-- p/ anon/authenticated = acesso direto negado.
create table if not exists public.imovel_visto (
  user_id uuid not null references auth.users(id) on delete cascade,
  imovel_id text not null,
  titulo text,
  cidade text,
  estado text,
  tipo text,
  valor numeric,
  vezes integer not null default 1,
  primeiro_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  primary key (user_id, imovel_id)
);
alter table public.imovel_visto enable row level security;

create or replace function public.registrar_imovel_visto(
  p_imovel_id text,
  p_titulo text default null,
  p_cidade text default null,
  p_estado text default null,
  p_tipo text default null,
  p_valor numeric default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce(p_imovel_id, '') = '' then return; end if;
  insert into public.imovel_visto (user_id, imovel_id, titulo, cidade, estado, tipo, valor)
  values (auth.uid(), p_imovel_id, p_titulo, p_cidade, p_estado, p_tipo, p_valor)
  on conflict (user_id, imovel_id) do update
    set vezes = public.imovel_visto.vezes + 1,
        visto_em = now(),
        titulo = coalesce(excluded.titulo, public.imovel_visto.titulo),
        cidade = coalesce(excluded.cidade, public.imovel_visto.cidade),
        estado = coalesce(excluded.estado, public.imovel_visto.estado),
        tipo   = coalesce(excluded.tipo, public.imovel_visto.tipo),
        valor  = coalesce(excluded.valor, public.imovel_visto.valor);
end;
$$;

revoke execute on function public.registrar_imovel_visto(text, text, text, text, text, numeric) from anon;
grant execute on function public.registrar_imovel_visto(text, text, text, text, text, numeric) to authenticated;
