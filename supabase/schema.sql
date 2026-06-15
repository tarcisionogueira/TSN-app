-- ============================================================
-- TSN ATIVOS — Schema Supabase
-- Execute no SQL Editor do painel Supabase
-- ============================================================

-- ─── EXTENSÕES ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── PERFIS (complementa auth.users) ────────────────────────
create table public.perfis (
  id          uuid references auth.users(id) on delete cascade primary key,
  nome        text not null,
  cpf         text unique,
  telefone    text,
  endereco    text,
  role        text not null default 'aluno'
                check (role in ('admin','aluno','assessor','advogado','atendente')),
  plano       text not null default 'gratuito'
                check (plano in ('gratuito','analista','gestor')),
  asaas_id    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.perfis enable row level security;
create policy "Usuário lê próprio perfil"   on public.perfis for select using (auth.uid() = id);
create policy "Usuário atualiza próprio perfil" on public.perfis for update using (auth.uid() = id);
create policy "Admin lê todos"              on public.perfis for select using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin')
);

-- Trigger: cria perfil automaticamente após signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.perfis (id, nome, cpf, telefone, endereco, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'cpf',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'endereco',
    coalesce(new.raw_user_meta_data->>'role', 'aluno')
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── CURSOS ──────────────────────────────────────────────────
create table public.cursos (
  id          uuid default uuid_generate_v4() primary key,
  titulo      text not null,
  subtitulo   text,
  descricao   text,
  emoji       text,
  cor         text default '#2563eb',
  bg          text default '#dbeafe',
  nivel       text default 'Iniciante',
  duracao     text,
  aulas       int default 0,
  preco       numeric(10,2) default 0,
  gratuito    boolean default false,
  categoria   text,
  destaque    boolean default false,
  ativo       boolean default true,
  ordem       int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.cursos enable row level security;
create policy "Qualquer um lê cursos ativos" on public.cursos for select using (ativo = true);
create policy "Admin gerencia cursos" on public.cursos for all using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin')
);

-- ─── MÓDULOS ─────────────────────────────────────────────────
create table public.modulos (
  id          uuid default uuid_generate_v4() primary key,
  curso_id    uuid references public.cursos(id) on delete cascade,
  titulo      text not null,
  ordem       int default 0,
  created_at  timestamptz default now()
);
alter table public.modulos enable row level security;
create policy "Qualquer um lê módulos" on public.modulos for select using (true);
create policy "Admin gerencia módulos" on public.modulos for all using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin')
);

-- ─── LIÇÕES ──────────────────────────────────────────────────
create table public.licoes (
  id          uuid default uuid_generate_v4() primary key,
  modulo_id   uuid references public.modulos(id) on delete cascade,
  titulo      text not null,
  descricao   text,
  video_url   text,
  duracao     text,
  gratis      boolean default false,
  ordem       int default 0,
  created_at  timestamptz default now()
);
alter table public.licoes enable row level security;
create policy "Qualquer um lê lições" on public.licoes for select using (true);
create policy "Admin gerencia lições" on public.licoes for all using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin')
);

-- ─── PROGRESSO ───────────────────────────────────────────────
create table public.progresso (
  user_id    uuid references auth.users(id) on delete cascade,
  licao_id   uuid references public.licoes(id) on delete cascade,
  concluido  boolean default true,
  updated_at timestamptz default now(),
  primary key (user_id, licao_id)
);
alter table public.progresso enable row level security;
create policy "Usuário vê próprio progresso" on public.progresso for all using (auth.uid() = user_id);

-- ─── PERGUNTAS ───────────────────────────────────────────────
create table public.perguntas (
  id             uuid default uuid_generate_v4() primary key,
  licao_id       uuid references public.licoes(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete cascade,
  texto          text not null,
  resposta       text,
  respondido_em  timestamptz,
  created_at     timestamptz default now()
);
alter table public.perguntas enable row level security;
create policy "Usuário vê próprias perguntas" on public.perguntas for select using (auth.uid() = user_id);
create policy "Usuário cria pergunta"         on public.perguntas for insert with check (auth.uid() = user_id);
create policy "Admin/assessor vê todas"       on public.perguntas for select using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','assessor','atendente'))
);
create policy "Admin/assessor responde"       on public.perguntas for update using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','assessor','atendente'))
);

-- ─── COMPRAS ─────────────────────────────────────────────────
create table public.compras (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  tipo        text not null check (tipo in ('curso','pacote','plano')),
  referencia  text,             -- curso_id, 'pacote-completo' ou plano key
  valor       numeric(10,2),
  status      text default 'pendente' check (status in ('pendente','pago','cancelado','reembolsado')),
  asaas_id    text,
  created_at  timestamptz default now()
);
alter table public.compras enable row level security;
create policy "Usuário vê próprias compras" on public.compras for select using (auth.uid() = user_id);
create policy "Admin vê todas compras"      on public.compras for select using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin')
);

-- ─── PROMOÇÕES ───────────────────────────────────────────────
create table public.promocoes (
  id          uuid default uuid_generate_v4() primary key,
  nome        text not null,
  codigo      text unique,
  desconto    numeric(5,2) not null,  -- percentual
  cursos      text[],                  -- array de curso_ids ou ['*'] para todos
  validade    date not null,
  ativo       boolean default true,
  usos_max    int,
  usos        int default 0,
  created_at  timestamptz default now()
);
alter table public.promocoes enable row level security;
create policy "Qualquer um lê promoções ativas" on public.promocoes for select using (ativo = true);
create policy "Admin gerencia promoções"         on public.promocoes for all using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin')
);

-- ─── IMÓVEIS (portfólio cloud) ───────────────────────────────
create table public.imoveis (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  dados       jsonb not null default '{}',
  status      text default 'analise',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.imoveis enable row level security;
create policy "Usuário vê próprios imóveis" on public.imoveis for all using (auth.uid() = user_id);
create policy "Gestor/assessor vê clientes" on public.imoveis for select using (
  exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','assessor','gestor'))
);

-- ─── LANÇAMENTOS FINANCEIROS ─────────────────────────────────
create table public.lancamentos (
  id          uuid default uuid_generate_v4() primary key,
  imovel_id   uuid references public.imoveis(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  data        date not null,
  tipo        text not null check (tipo in ('entrada','saida')),
  categoria   text,
  descricao   text,
  valor       numeric(15,2) not null,
  created_at  timestamptz default now()
);
alter table public.lancamentos enable row level security;
create policy "Usuário gerencia próprios lançamentos" on public.lancamentos for all using (auth.uid() = user_id);

-- ─── ÍNDICES ─────────────────────────────────────────────────
create index on public.modulos(curso_id);
create index on public.licoes(modulo_id);
create index on public.progresso(user_id);
create index on public.perguntas(licao_id);
create index on public.perguntas(user_id);
create index on public.compras(user_id);
create index on public.imoveis(user_id);
create index on public.lancamentos(imovel_id);
