-- Proposta de compra direta ao leiloeiro, em veículo com leilão negativo (17/09, pedido do
-- dono): "veículos em leilão às vezes conseguimos fazer propostas para venda direta em caso
-- de leilão negativo o que pode vir a render frutos". Mesmo padrão de
-- `pedido_documento_leiloeiro.sql` (11/09) — reaproveita `leiloeiro_contato`, já alimentado
-- pela captura automática do scraper (agora também para veículo, ver
-- retencaoVeiculosVencidos/salvarVeiculos em scripts/scraper-puppeteer.mjs).
--
-- Auditoria: nenhuma mutação sem rastro (convenção do projeto). Registra TODA tentativa,
-- inclusive sem contato cadastrado (`status='sem_contato'`) — mede quanto falta cadastrar.
create table if not exists public.veiculo_propostas_leiloeiro (
  id                  uuid primary key default gen_random_uuid(),
  veiculo_id          uuid not null,
  user_id             uuid not null,
  fonte               text,
  destinatario_email  text,
  texto_enviado       text,
  resend_id           text,
  status              text not null, -- 'enviado' | 'sem_contato' | 'falha' | 'limitado'
  criado_em           timestamptz not null default now()
);
alter table public.veiculo_propostas_leiloeiro enable row level security;
drop policy if exists "service_only_veiculo_propostas_leiloeiro" on public.veiculo_propostas_leiloeiro;
create policy "service_only_veiculo_propostas_leiloeiro" on public.veiculo_propostas_leiloeiro for all using (false);
create index if not exists idx_veiculo_propostas_leiloeiro_veiculo on public.veiculo_propostas_leiloeiro (veiculo_id, criado_em desc);
create index if not exists idx_veiculo_propostas_leiloeiro_user    on public.veiculo_propostas_leiloeiro (user_id, criado_em desc);
