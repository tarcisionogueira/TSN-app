-- Tabela de controle do tour de onboarding
create table if not exists public.tour_progresso (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  versao     text not null,    -- 'YYYY-MM' do mês corrente
  visualizacoes integer default 0,
  completo   boolean default false,
  ultima_vez timestamptz default now(),
  unique(user_id, versao)
);

alter table public.tour_progresso enable row level security;

drop policy if exists "Usuário lê/escreve próprio progresso" on public.tour_progresso;
create policy "Usuário lê/escreve próprio progresso" on public.tour_progresso
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Tabela de definição das etapas do tour (admin gerencia)
create table if not exists public.tour_etapas (
  id          uuid default gen_random_uuid() primary key,
  versao      text not null,        -- 'YYYY-MM' do mês em que foi lançada
  ordem       integer not null,
  rota        text not null,        -- ex: '/painel', '/buscar'
  titulo      text not null,
  descricao   text not null,
  roles       text[] default '{}',  -- [] = todos; ['top1','top2'] = restritos
  ativo       boolean default true,
  criado_em   timestamptz default now()
);

alter table public.tour_etapas enable row level security;

drop policy if exists "Público lê etapas ativas" on public.tour_etapas;
create policy "Público lê etapas ativas" on public.tour_etapas
  for select using (ativo = true);

drop policy if exists "Admin gerencia etapas" on public.tour_etapas;
create policy "Admin gerencia etapas" on public.tour_etapas
  using (public.is_equipe())
  with check (public.is_equipe());

create index if not exists idx_tour_etapas_versao on public.tour_etapas(versao, ordem);

-- Tabela de logs dos scrapers (monitoramento)
create table if not exists public.scrapers_log (
  id          uuid default gen_random_uuid() primary key,
  fonte       text not null,         -- 'santander', 'rodobens', 'sold', etc.
  status      text not null,         -- 'ok', 'erro', 'sem_dados'
  imoveis_encontrados integer default 0,
  erro_msg    text,
  iniciado_em timestamptz default now(),
  duracao_ms  integer
);

alter table public.scrapers_log enable row level security;

drop policy if exists "Equipe lê logs scrapers" on public.scrapers_log;
create policy "Equipe lê logs scrapers" on public.scrapers_log
  for select using (public.is_equipe());

create index if not exists idx_scrapers_log_fonte on public.scrapers_log(fonte, iniciado_em desc);

-- Inserir etapas do tour para o mês atual (ajuste conforme necessário)
insert into public.tour_etapas (versao, ordem, rota, titulo, descricao, roles) values
  (to_char(now(), 'YYYY-MM'), 1, '/',          'Bem-vindo ao TSN Ativos',      'Sua plataforma completa para análise e acompanhamento de imóveis em leilão. Vamos conhecer todas as funcionalidades?', '{}'),
  (to_char(now(), 'YYYY-MM'), 2, '/buscar',    'Busca de Leilões',             'Encontre imóveis em leilão de múltiplos bancos e fontes. Filtre por cidade, tipo, valor e muito mais.', '{}'),
  (to_char(now(), 'YYYY-MM'), 3, '/analise',   'Análise de Imóveis',           'Solicite avaliações detalhadas: mercadológica, edital + matrícula e processual. Laudos gerados pela equipe especializada.', '{}'),
  (to_char(now(), 'YYYY-MM'), 4, '/calculadora','Calculadora de Lance',        'Calcule o lance máximo, custos totais, necessidade de caixa e ROI estimado antes de arrematar.', array['top1','top2','assessorado','clube','consultor','analista','advogado','admin']),
  (to_char(now(), 'YYYY-MM'), 5, '/painel',    'Meu Painel',                   'Acompanhe seus imóveis em análise, aprovados, arrematados e o controle financeiro de cada ativo.', '{}'),
  (to_char(now(), 'YYYY-MM'), 6, '/contratos', 'Contratos Digitais',           'Assine contratos digitalmente com validade jurídica. Geolocalização, testemunhas e hash criptográfico incluídos.', '{}'),
  (to_char(now(), 'YYYY-MM'), 7, '/membros',   'Área de Membros',              'Acesse os cursos exclusivos TSN: estratégias de leilão, avaliação de ativos e muito mais.', '{}'),
  (to_char(now(), 'YYYY-MM'), 8, '/planos',    'Planos de Acesso',             'Conheça os planos disponíveis e evolua seu nível de acesso para desbloquear mais funcionalidades.', '{}')
on conflict do nothing;
