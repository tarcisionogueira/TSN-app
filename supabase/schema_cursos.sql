-- ─── CURSOS (gerenciados pelo admin) ──────────────────────────────────────────
create table if not exists public.cursos_admin (
  id            uuid default gen_random_uuid() primary key,
  titulo        text not null,
  subtitulo     text,
  descricao     text,
  emoji         text default '📚',
  cor           text default '#2563eb',
  nivel         text default 'Iniciante',     -- Iniciante / Intermediário / Avançado
  categoria     text default 'Fundamentos',
  preco         numeric default 0,            -- 0 = gratuito
  gratuito      boolean default false,
  destaque      boolean default false,
  ativo         boolean default true,
  comissao_pct  numeric default 30,           -- % de comissão para o consultor/afiliado
  ordem         integer default 0,
  criado_em     timestamptz default now()
);

-- Aulas de cada curso (com URL de vídeo player-agnóstica)
create table if not exists public.aulas_admin (
  id            uuid default gen_random_uuid() primary key,
  curso_id      uuid references public.cursos_admin(id) on delete cascade,
  modulo        text default 'Módulo 1',
  titulo        text not null,
  descricao     text,
  video_url     text,                         -- YouTube não-listado, Vimeo, Panda, MP4...
  duracao       text default '',
  gratis        boolean default false,        -- amostra grátis (preview)
  ordem         integer default 0,
  criado_em     timestamptz default now()
);

-- eBooks / materiais complementares
create table if not exists public.ebooks_admin (
  id            uuid default gen_random_uuid() primary key,
  titulo        text not null,
  descricao     text,
  capa_url      text,
  arquivo_url   text,                          -- PDF hospedado
  gratuito      boolean default true,
  ativo         boolean default true,
  criado_em     timestamptz default now()
);

create index if not exists idx_aulas_curso on public.aulas_admin(curso_id);

-- RLS: leitura pública dos ativos; escrita só admin/service_role
alter table public.cursos_admin enable row level security;
alter table public.aulas_admin  enable row level security;
alter table public.ebooks_admin enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='cursos_admin' and policyname='Leitura publica cursos') then
    create policy "Leitura publica cursos" on public.cursos_admin for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='aulas_admin' and policyname='Leitura publica aulas') then
    create policy "Leitura publica aulas" on public.aulas_admin for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='ebooks_admin' and policyname='Leitura publica ebooks') then
    create policy "Leitura publica ebooks" on public.ebooks_admin for select using (true);
  end if;
end $$;

-- Escrita: apenas usuários com role=admin na tabela perfis
do $$ begin
  if not exists (select 1 from pg_policies where tablename='cursos_admin' and policyname='Admin gerencia cursos') then
    create policy "Admin gerencia cursos" on public.cursos_admin for all
      using (exists (select 1 from public.perfis where id = auth.uid() and role = 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename='aulas_admin' and policyname='Admin gerencia aulas') then
    create policy "Admin gerencia aulas" on public.aulas_admin for all
      using (exists (select 1 from public.perfis where id = auth.uid() and role = 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename='ebooks_admin' and policyname='Admin gerencia ebooks') then
    create policy "Admin gerencia ebooks" on public.ebooks_admin for all
      using (exists (select 1 from public.perfis where id = auth.uid() and role = 'admin'));
  end if;
end $$;
