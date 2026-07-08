-- Corrige imóveis da Caixa (CEF) gravados como 'judicial'. A Caixa NÃO é judicial:
-- os leilões são SFI/alienação fiduciária (Lei 9.514) = EXTRAJUDICIAL (leilão
-- extrajudicial). O executado é o ex-mutuário; não há processo judicial.
--
-- CAUSA RAIZ (corrigida no código): scripts/scraper.js → normalizarModalidadeCEF()
-- mapeava qualquer "leilão"/"praça" da Caixa para 'judicial'. Passou a devolver
-- 'extrajudicial'. Esta migração acerta os registros históricos (idempotente).
--
-- Obs.: a versão anterior desta migração (mesmo nome) NÃO chegou a ser aplicada em
-- produção e, ainda que fosse, o scraper reescrevia 'judicial' a cada rodada — por
-- isso a correção só é durável junto com o fix no código.
update public.imoveis_leilao
   set modalidade = 'extrajudicial'
 where fonte in ('CEF', 'caixa') and modalidade = 'judicial';
