-- Arquivamento de TODOS os documentos conhecidos de cada lote (21/11, dono: "faça o mesmo para os
-- outros leiloeiros", depois de a Zuk passar a guardar todos os documentos).
--
-- A fila genérica (`enfileirar_docs_arquivar` + captura-documentos.mjs) dá o lote por resolvido
-- assim que UM documento chega ao Storage: em 21/11 eram 9.329 lotes ativos com link de documento
-- conhecido (anexos / link_matricula / edital PDF) que nunca foi guardado — ~19 mil arquivos que
-- ficavam só no site do leiloeiro (e somem quando o leilão sai do ar).
--
-- `scripts/arquivar-docs-conhecidos.mjs` baixa cada link conhecido direto (fetch, sem navegador,
-- sem Bright Data) e grava `imovel_anexos.origem_url`. Esta coluna é o carimbo de "já passei por
-- este lote": a rotina volta a ele depois de 30 dias (links novos que o coletor trouxer).
-- A seleção é feita no script em fatias pequenas pelo índice parcial abaixo — a consulta única
-- sobre o acervo inteiro levou 8,8 s (medido) e competiria com o app.
alter table public.imoveis_leilao add column if not exists docs_arquivados_em timestamptz;

create index if not exists idx_imoveis_leilao_docs_arquivar
  on public.imoveis_leilao (data_leilao nulls last)
  where ativo and docs_arquivados_em is null;

create index if not exists idx_imovel_anexos_origem_url
  on public.imovel_anexos (imovel_id, origem_url)
  where origem_url is not null;
