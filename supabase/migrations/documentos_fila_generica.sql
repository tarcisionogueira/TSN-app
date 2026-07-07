-- Fila GENÉRICA de captura de documentos por navegador real (qualquer leiloeiro
-- integrado que não a Caixa — essa tem a sua própria cef_matricula_fila).
-- O job scripts/captura-documentos.mjs (GitHub Actions, a cada 15 min) lê os
-- pendentes, abre a página do lote com Puppeteer, baixa os PDFs (edital/matrícula/
-- laudo/regras) e guarda no Storage + imovel_anexos. A análise documental lê de lá.

create table if not exists public.documentos_fila (
  imovel_id     uuid primary key references public.imoveis_leilao(id) on delete cascade,
  status        text not null default 'pendente',   -- pendente | processando | ok | erro
  tentativas    integer not null default 0,
  erro          text,
  criado_em     timestamptz default now(),
  processado_em timestamptz
);

-- Índice para o job pegar rápido só os pendentes mais antigos.
create index if not exists documentos_fila_pendentes_idx
  on public.documentos_fila (criado_em)
  where status = 'pendente';

alter table public.documentos_fila enable row level security;

-- Equipe (admin/consultor/analista/advogado) pode acompanhar a fila.
drop policy if exists documentos_fila_select_equipe on public.documentos_fila;
create policy documentos_fila_select_equipe on public.documentos_fila
  for select using (
    exists (
      select 1 from public.perfis p
      where p.id = auth.uid()
        and p.role in ('admin', 'consultor', 'analista', 'advogado')
    )
  );
