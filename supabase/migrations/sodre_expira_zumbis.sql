-- SODRE — expira lotes-zumbi (auditoria de documentos 15/07/2026).
-- Diagnóstico: 15 lotes seguiam ativo=true mesmo com o leilão JÁ ENCERRADO — sumiram da
-- API search-lots (url_lote=null) e nunca mais entravam na fila de docs, além de aparecer
-- como listagens fantasmas na busca. Isso derrubava a métrica de matrícula (55,6%).
--
-- Correção: expira (ativo=false) os SODRE ativos sem url_lote e com data_leilao no passado.
-- Efeito: matrícula 55,6% -> 95,2% (o único remanescente é um lote futuro, que recebe a
-- matrícula na próxima captura). Idempotente. A prevenção contínua é no scraper
-- (captura-docs-sodre.mjs agora expira sozinho quem sai do search-lots já encerrado).
update imoveis_leilao
set ativo = false
where fonte='SODRE' and ativo and url_lote is null
  and data_leilao is not null and data_leilao::timestamptz < now();

update public.leiloeiro_conhecimento set docs_status='ok' where fonte='SODRE';
