-- Tabela de imóveis em leilão (populada pelo scraper diário)
create table if not exists public.imoveis_leilao (
  id              uuid default gen_random_uuid() primary key,
  fonte           text not null,          -- 'CEF', 'SOLD', 'JUDICIAL'
  fonte_id        text not null unique,   -- ID único da fonte para deduplicação
  titulo          text,
  tipo            text,                   -- 'apartamento','casa','terreno','comercial','imovel'
  modalidade      text,                   -- 'judicial','extrajudicial'
  estado          text,
  cidade          text,
  bairro          text,
  endereco        text,
  valor_avaliacao numeric default 0,
  valor_minimo    numeric default 0,
  desconto_percentual integer,
  area_m2         numeric default 0,
  descricao       text,
  link_edital     text,
  link_foto       text,
  leiloeiro       text,
  data_leilao     text,
  forma_pagamento text default 'a_vista', -- 'a_vista','financiado','parcelado'
  viavel          boolean,                -- null=não avaliado, true=viável, false=inviável
  score_viabilidade integer default 0,
  motivo_viabilidade text,
  ativo           boolean default true,
  raw             text,
  atualizado_em   timestamptz default now(),
  criado_em       timestamptz default now()
);

-- Índices para busca rápida
create index if not exists idx_imoveis_leilao_estado    on public.imoveis_leilao(estado);
create index if not exists idx_imoveis_leilao_cidade    on public.imoveis_leilao(cidade);
create index if not exists idx_imoveis_leilao_tipo      on public.imoveis_leilao(tipo);
create index if not exists idx_imoveis_leilao_modalidade on public.imoveis_leilao(modalidade);
create index if not exists idx_imoveis_leilao_viavel    on public.imoveis_leilao(viavel);
create index if not exists idx_imoveis_leilao_ativo     on public.imoveis_leilao(ativo);
create index if not exists idx_imoveis_leilao_valor     on public.imoveis_leilao(valor_minimo);

-- RLS: leitura pública (imóveis são dados públicos de leilão)
alter table public.imoveis_leilao enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'imoveis_leilao' and policyname = 'Leitura publica de imoveis'
  ) then
    create policy "Leitura publica de imoveis" on public.imoveis_leilao
      for select using (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'imoveis_leilao' and policyname = 'Service role gerencia imoveis'
  ) then
    create policy "Service role gerencia imoveis" on public.imoveis_leilao
      for all using (auth.role() = 'service_role');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'perfis' and policyname = 'Leitura proprio perfil'
  ) then
    create policy "Leitura proprio perfil" on public.perfis
      for select using (auth.uid() = id);
  end if;
end $$;
