-- APRENDIZADO NA EMISSÃO (loop unificado dos agentes). Cada gerador de relatório grava,
-- ao emitir, uma lição durável: CORPUS (fatos observados, poison-resistentes) + QUALIDADE
-- (sinais do que faltou/assumiu). Basta 1 relatório (ex.: mercadológico) para já ensinar.
--
-- DURÁVEL POR DESIGN: tabela SEPARADA de analises_* (os relatórios). O cron
-- limpar_analises_orfas só apaga analises_mercado/documental de imóveis não-arrematados
-- e NÃO toca aqui; não há FK em CASCADE. Apagar o relatório do lote não-arrematado
-- NUNCA apaga a lição.
--
-- Unificada: todos os agentes (mercadologico/documental/laudo/…) gravam nesta base, e o
-- MODERADOR lê daqui para supervisionar (frescor/volume por agente).
create table if not exists public.agente_aprendizado (
  id         bigint generated always as identity primary key,
  agente     text not null,               -- 'mercadologico' | 'documental' | 'laudo' | ...
  imovel_id  text,
  cidade     text,
  uf         text,
  tipo       text,
  modalidade text,
  corpus     jsonb not null default '{}'::jsonb,   -- fatos observados (só dado do imóvel/pesquisa; nunca input do usuário)
  qualidade  jsonb not null default '{}'::jsonb,   -- sinais: avaliacao_ausente, minimo_ausente, mercado_vazio, sem_parecer
  criado_em  timestamptz not null default now()
);
create index if not exists idx_agente_aprend_agente_criado on public.agente_aprendizado (agente, criado_em desc);
create index if not exists idx_agente_aprend_regiao on public.agente_aprendizado (uf, tipo, criado_em desc);

alter table public.agente_aprendizado enable row level security;
-- Escrita só pelo servidor (service key, bypassa RLS). Leitura só admin. Não é dado de
-- usuário (chaveado por imovel_id) → sem coluna de dono → não é flagrado por auditoria_uso().
drop policy if exists agente_aprend_admin on public.agente_aprendizado;
create policy agente_aprend_admin on public.agente_aprendizado for all using (public.is_admin());

comment on table public.agente_aprendizado is 'Aprendizado NA EMISSAO de relatorios (corpus + qualidade) por agente. Duravel: separado de analises_* (nao e apagado com o relatorio). Alimenta prompts futuros por regiao/tipo e a supervisao do moderador.';
