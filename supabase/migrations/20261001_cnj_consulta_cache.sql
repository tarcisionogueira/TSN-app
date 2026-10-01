-- CACHE DAS CONSULTAS CNJ (DataJud) e DJEN (01/10) — ver api/_cnj.js (cacheLer/cacheGravar).
-- Resposta BRUTA de sucesso por 3 h; falha nunca entra. Só service_role (RLS sem policy).
-- Limpeza: api/cnj-monitor-cron.js apaga o que passou de 1 dia.
create table if not exists public.cnj_consulta_cache (
  chave      text primary key,           -- 'datajud:<sha256>' | 'djen:<sha256>'
  fonte      text not null check (fonte in ('datajud', 'djen')),
  dados      jsonb not null,
  criado_em  timestamptz not null default now()
);
create index if not exists cnj_consulta_cache_criado_idx on public.cnj_consulta_cache (criado_em);
alter table public.cnj_consulta_cache enable row level security;
revoke all on public.cnj_consulta_cache from anon, authenticated;
