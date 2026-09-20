-- Relatório de análise de VEÍCULO (21/09, pedido do dono). Espelha `analises_mercado`
-- (mesmo padrão de RLS/upsert), mas é UM relatório só por veículo — condição do veículo +
-- FIPE atualizada + veredito de compra —, não dois como imóvel (mercadológico+documental):
-- o dono foi explícito que, no lugar de pesquisa mercadológica aprofundada, o relatório de
-- veículo é "condições do veículo pra ter uma noção se é uma boa compra ou não", com base em
-- tudo que o leiloeiro disponibilizar (edital/descrição/anexos do lote) — não há matrícula,
-- ITBI nem comparáveis geocodificados para um veículo, então não existe um segundo relatório
-- "documental/processual" separado aqui.
create table if not exists public.analises_veiculo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  veiculo_id uuid not null references public.veiculos_leilao(id) on delete cascade,
  titulo text,
  marca text,
  modelo text,
  veiculo jsonb,                 -- snapshot do veículo no momento da geração (mesmo papel de analises_mercado.imovel)
  inputs jsonb,
  result jsonb,                  -- { parecer, fipeValor, percentualFipe, faixaFipe, riscos[], condicoes, precisaDocumentos, status-fields }
  status text not null default 'gerando' check (status in ('gerando','concluida','erro')),
  erro text,
  regen_tentativas int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists analises_veiculo_user_veiculo_unico
  on public.analises_veiculo (user_id, veiculo_id);
create index if not exists analises_veiculo_veiculo_idx on public.analises_veiculo (veiculo_id);

alter table public.analises_veiculo enable row level security;

-- Mesma régua de analises_mercado_select_consolidada (dono + staff que atua em nome dele).
create policy "analises_veiculo_select_consolidada" on public.analises_veiculo
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','analista'))
  );
create policy "analises_veiculo_insert" on public.analises_veiculo
  for insert with check (auth.uid() = user_id);
create policy "analises_veiculo_update" on public.analises_veiculo
  for update using (auth.uid() = user_id);
-- Escrita real (geração) é sempre via service_role em api/gerar-analise-veiculo.js, que
-- ignora RLS; as policies insert/update acima cobrem só o caminho direto do cliente (nenhum
-- existe hoje, mas evita uma tabela sem WITH CHECK, mesmo princípio de analises_mercado).
