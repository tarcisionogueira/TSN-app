-- Radar do CALENDÁRIO OFICIAL de leilões do MJ/SENAD (Power BI público "publish to web").
-- Fonte ADICIONAL: cruza com o acervo p/ marcar leilões/leiloeiros já conhecidos × novos, e
-- traz LINK DO EDITAL/LEILÃO oficiais. Snapshot (delete/insert) por scripts/scraper-powerbi-mj.mjs.
create table if not exists public.leiloes_mj_radar (
  id            uuid primary key default gen_random_uuid(),
  link_leilao   text,
  uf            text,
  contrato      text,
  leiloeiro     text,
  fiscal        text,
  data_leilao   text,
  data_hasta2   text,
  ativos_qtd    integer,
  link_edital   text,
  especie       text default 'IMÓVEL',
  leiloeiro_no_acervo boolean default false,
  atualizado_em timestamptz default now(),
  visto_em      timestamptz default now()
);
create index if not exists idx_leiloes_mj_radar_link on public.leiloes_mj_radar (link_leilao);
alter table public.leiloes_mj_radar enable row level security;
drop policy if exists leiloes_mj_radar_admin_sel on public.leiloes_mj_radar;
create policy leiloes_mj_radar_admin_sel on public.leiloes_mj_radar
  for select to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
