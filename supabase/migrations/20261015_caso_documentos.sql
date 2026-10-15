-- Documentos do caso organizados pela IA (15/10, dono): "separando os documentos pessoais e os documentos
-- da arrematação; a IA deve ler os anexos para organizar".
--
-- Fonte: anexos ARQUIVADOS (email_caixa.anexos[i].arquivo, bucket privado `documentos`) de e-mails ligados a
-- um caso — inclusive os reencaminhados do Gmail da Reimob em 15/10. O caso-documentos-cron lê cada arquivo
-- (PDF, foto, Word, ZIP via _doc-blocos.js) e grava aqui o grupo e o tipo. O arquivo NÃO é copiado: a linha
-- aponta para o mesmo storage_path (um só arquivo, um só backup).

create table if not exists public.caso_documentos (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.casos(id) on delete cascade,
  email_id uuid references public.email_caixa(id) on delete set null,
  anexo_idx int not null,
  nome text not null,
  storage_path text not null,
  grupo text not null check (grupo in ('pessoal', 'arrematacao', 'outro')),
  tipo text,                -- rg, cnh, cpf, comprovante_residencia, certidao_casamento, procuracao, edital, matricula,
                            -- auto_arrematacao, carta_arrematacao, guia_deposito, itbi, decisao_judicial,
                            -- exigencia_cartorio, notificacao, comprovante_pagamento, parecer_juridico, laudo, outro
  titulo text,
  resumo text,
  data_documento date,
  pessoa text,              -- de quem é o documento pessoal (nome lido), quando houver
  lido boolean not null default true,   -- false = classificado só pelo nome (arquivo ilegível ou grande demais)
  provedor text,
  criado_em timestamptz not null default now(),
  unique (storage_path)
);
create index if not exists caso_documentos_caso_idx on public.caso_documentos (caso_id, grupo);

alter table public.caso_documentos enable row level security;
drop policy if exists caso_documentos_equipe on public.caso_documentos;
create policy caso_documentos_equipe on public.caso_documentos for select using (public.pode_caixa_email());

-- Correção manual na tela (api/caso-documentos.js): quem moveu, quando e o grupo que a IA tinha dado.
alter table public.caso_documentos add column if not exists corrigido_por uuid;
alter table public.caso_documentos add column if not exists corrigido_em timestamptz;
alter table public.caso_documentos add column if not exists grupo_ia text;
comment on column public.caso_documentos.grupo_ia is 'Grupo que a IA tinha dado antes da correção manual (sinal de erro da classificação).';
