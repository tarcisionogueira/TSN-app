-- 25/09: a captura logada da ZUK passa a guardar TODOS os documentos da página (laudo, certidões,
-- cópia do processo…), não só a matrícula — para os lotes em uso (caso/análise) e os pedidos à mão.
-- `zuk_docs_em` marca que o lote já foi varrido (fase 2 de scripts/captura-matricula-zuk.mjs).
alter table public.imoveis_leilao add column if not exists zuk_docs_em timestamptz;
