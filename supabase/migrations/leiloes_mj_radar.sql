-- Radar do CALENDÁRIO OFICIAL de leilões do MJ/SENAD (Power BI público "publish to web").
-- Snapshot semanal (o scraper faz delete-all + insert). Fonte adicional/cruzamento com o acervo.
-- id sintético: o link não é único (mesmo leiloeiro repete; alguns vêm só domínio).
drop table if exists public.leiloes_mj_radar;
create table public.leiloes_mj_radar (
  id            uuid primary key default gen_random_uuid(),
  uf            text,
  contrato      text,
  leiloeiro     text,
  fiscal        text,
  data_leilao   date,
  data_hasta2   date,
  ativos_qtd    integer,
  link_leilao   text,
  link_edital   text,
  especie       text default 'IMÓVEL',
  leiloeiro_no_acervo boolean default false,
  atualizado_em timestamptz default now()
);
alter table public.leiloes_mj_radar enable row level security;
drop policy if exists leiloes_mj_radar_admin_sel on public.leiloes_mj_radar;
create policy leiloes_mj_radar_admin_sel on public.leiloes_mj_radar
  for select to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
