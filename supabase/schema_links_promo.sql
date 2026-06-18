-- ============================================================
-- Links promocionais com desconto
-- Permite admin e consultor criarem links com desconto para
-- produtos específicos. O cliente acessa /promo/CODIGO e vê
-- a landing page com o preço promocional.
-- ============================================================

create table if not exists public.links_promo (
  id                uuid default gen_random_uuid() primary key,
  codigo            text unique not null,             -- ex: "TSNVIP30"
  produto           text not null,                    -- 'top1','top2','assessorado','clube'
  descricao_condicoes text,                           -- texto para o consultor exibir ao lead
  desconto_pct      numeric(5,2) default 0,           -- % de desconto (ex: 30 = 30%)
  desconto_valor    numeric default 0,                -- desconto em R$ (alternativo ao %)
  ativo             boolean default true,
  usos              integer default 0,                -- contador de acessos
  criado_por        uuid references auth.users(id),
  criado_em         timestamptz default now()
);

alter table public.links_promo enable row level security;

-- Admin gerencia tudo
drop policy if exists "Admin gerencia links_promo" on public.links_promo;
create policy "Admin gerencia links_promo" on public.links_promo
  for all using (public.is_admin());

-- Consultor vê e cria os próprios
drop policy if exists "Consultor vê próprios links" on public.links_promo;
create policy "Consultor vê próprios links" on public.links_promo
  for select using (auth.uid() = criado_por);

drop policy if exists "Consultor cria links" on public.links_promo;
create policy "Consultor cria links" on public.links_promo
  for insert with check (
    auth.uid() = criado_por
    and exists (select 1 from public.perfis where id = auth.uid() and role = 'consultor')
  );

drop policy if exists "Consultor desativa próprios links" on public.links_promo;
create policy "Consultor desativa próprios links" on public.links_promo
  for update using (auth.uid() = criado_por);

-- Qualquer pessoa pode LER um link pelo código (para a landing page funcionar sem login)
drop policy if exists "Público lê links ativos" on public.links_promo;
create policy "Público lê links ativos" on public.links_promo
  for select using (ativo = true);

create index if not exists idx_links_promo_codigo on public.links_promo(codigo);
create index if not exists idx_links_promo_criado_por on public.links_promo(criado_por);
