-- ─────────────────────────────────────────────────────────────────────────────────────────
-- #238 (20/10): o motor (scripts/lib/motor/runner.mjs) põe na frente da fila os lotes "novos" = ausentes de
-- imoveis_leilao. Lote RECUSADO na leitura (encerrado, não-imóvel, descartado pela qualidade) nunca é gravado,
-- então voltava como "novo" em TODA rodada e gastava leitura paga antes dos ainda não lidos. EMILIOMATOS 19/10:
-- 55 leituras (teto Firecrawl) → 35 gravados; os ~20 recusados repetiriam na semana seguinte, e se acumulam.
-- Esta tabela é a memória da recusa: o runner pula o lote até `rever_apos` (30 dias se a recusa é permanente,
-- 10 se pode ser temporária — sem valor/data). Só o service role (runner) lê e grava.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.coleta_lote_recusado (
  fonte_id   text primary key,
  fonte      text not null,
  motivo     text not null,
  visto_em   timestamptz not null default now(),
  rever_apos timestamptz not null
);
create index if not exists coleta_lote_recusado_fonte_idx on public.coleta_lote_recusado (fonte, rever_apos);
-- RLS ligada e SEM política = anon/authenticated não leem nem gravam (o service role ignora RLS).
alter table public.coleta_lote_recusado enable row level security;
comment on table public.coleta_lote_recusado is
  'Memória de lote recusado na coleta (encerrado/não-imóvel/descartado): o runner não o relê até rever_apos. Ver #238.';
