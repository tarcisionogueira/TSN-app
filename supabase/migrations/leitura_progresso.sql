-- Progresso de LEITURA do eBook (o leitor paginado estilo Kindle).
--
-- POR QUÊ: "virar a página com um toque CONTABILIZANDO A EVOLUÇÃO DA LEITURA" (pedido do dono).
-- Guardar só no localStorage resolveria o "continuar de onde parei" no MESMO navegador — e
-- perderia tudo quando o leitor abrisse no celular depois de começar no computador, que é
-- exatamente quando um leitor de eBook precisa lembrar. Aqui fica na conta, não no aparelho.
-- (O localStorage segue como espelho: funciona offline e não faz o leitor esperar o banco.)
--
-- Genérica de propósito (`item_tipo`): hoje 'ebook', amanhã apostila/material de curso, sem
-- migração nova.
create table if not exists public.leitura_progresso (
  user_id       uuid not null references auth.users(id) on delete cascade,
  item_tipo     text not null default 'ebook',
  item_id       text not null,
  pagina        integer not null default 1,
  total_paginas integer,
  pct           numeric,
  concluido_em  timestamptz,          -- carimbado ao chegar na última página
  atualizado_em timestamptz not null default now(),
  primary key (user_id, item_tipo, item_id)
);

create index if not exists leitura_progresso_item_idx on public.leitura_progresso (item_tipo, item_id);

alter table public.leitura_progresso enable row level security;

-- Cada um vê e escreve só o próprio progresso (mesmo desenho de aula_progresso).
drop policy if exists leitura_progresso_select_own on public.leitura_progresso;
create policy leitura_progresso_select_own on public.leitura_progresso
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists leitura_progresso_insert_own on public.leitura_progresso;
create policy leitura_progresso_insert_own on public.leitura_progresso
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists leitura_progresso_update_own on public.leitura_progresso;
create policy leitura_progresso_update_own on public.leitura_progresso
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.leitura_progresso is
  'Onde cada usuario parou em cada eBook (leitor paginado). Fica na CONTA e nao no aparelho: comecar no desktop e continuar no celular. localStorage e so espelho.';
