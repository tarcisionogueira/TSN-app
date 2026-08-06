-- ─────────────────────────────────────────────────────────────────────────────
-- LEITURA DE DOCUMENTO: "LEIA 1 VEZ, USE EM TODO LUGAR" (pedido do dono, 05/08)
--
-- Motivação: o mercadológico precisa da METRAGEM DA MATRÍCULA (casos documentados
-- de divergência com o anúncio) e da FORMA DE PAGAMENTO do edital (fluxo de caixa
-- por modalidade) — minimizando custo. Hoje cada geração de relatório re-lê os
-- documentos (inclusive com IA); regenerar = pagar de novo.
--
-- 1) doc_extracoes — cache de extração POR DOCUMENTO.
--    chave = 'h:<md5 do texto>' (conteúdo, eterna) ou 'u:<url canônica>' (pré-download,
--    revalidada por idade). `campos` acumula o que CADA leitor extraiu (regex grátis,
--    Claude, visão do documental); um campo só é sobrescrito por extrator de confiança
--    MAIOR OU IGUAL. Quem lê primeiro grava; mercadológico, documental e laudo reusam.
-- 2) leiloeiro_pagamento_prior — o "agente que aprende": frequência dos termos de
--    pagamento por leiloeiro × modalidade. Cada extração bem-sucedida vota; lote cujo
--    edital não abre herda o CONSENSO (moda com ≥2 amostras), rotulado como estimativa.
--
-- Ambas service-only: RLS ligado SEM policy (só a service key do backend acessa).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.doc_extracoes (
  chave text primary key,
  url text,
  imovel_id text,
  tipo_doc text,                       -- edital | matricula | regras | outro
  campos jsonb not null default '{}',
  extrator jsonb not null default '{}', -- por CAMPO: {"areaPrivativaM2": {"via": "regex", "confianca": 60}}
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists doc_extracoes_imovel_idx on public.doc_extracoes (imovel_id);
alter table public.doc_extracoes enable row level security;

create table if not exists public.leiloeiro_pagamento_prior (
  fonte text not null,
  modalidade text not null default '',
  freq jsonb not null default '{}',    -- {campo: {"valor": contagem}}
  amostras int not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (fonte, modalidade)
);
alter table public.leiloeiro_pagamento_prior enable row level security;
