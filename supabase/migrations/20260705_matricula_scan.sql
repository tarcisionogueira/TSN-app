-- Marca quando a matrícula (PDF de texto) já foi varrida pelo backfill grátis de
-- cartório/ofício/comarca (scripts/enriquecer-cartorio-matricula.mjs). Evita
-- reprocessar PDFs sem texto/escaneados a cada execução. NULL = ainda não varrido.
alter table imoveis_leilao add column if not exists matricula_scan_em timestamptz;
create index if not exists idx_imoveis_matricula_scan on imoveis_leilao (matricula_scan_em nulls first);
