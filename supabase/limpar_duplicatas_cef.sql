-- ============================================================
-- Limpeza de duplicatas CEF criadas pelo scraper-caixa.mjs antigo
-- O formato antigo usava prefixo "CEF-" (ex: CEF-12345)
-- O formato correto (scraper.js) usa "cef_" (ex: cef_12345)
-- Execute este script UMA VEZ no Supabase SQL Editor
-- ============================================================

-- 1. Remove registros com prefixo antigo "CEF-" que sejam duplicatas do registro correto "cef_"
DELETE FROM public.imoveis_leilao old_rec
WHERE old_rec.fonte_id LIKE 'CEF-%'
  AND EXISTS (
    SELECT 1 FROM public.imoveis_leilao new_rec
    WHERE new_rec.fonte = 'CEF'
      AND new_rec.fonte_id = 'cef_' || SUBSTRING(old_rec.fonte_id FROM 5)
  );

-- 2. Renomeia os registros "CEF-" restantes (sem duplicata correspondente) para o formato correto
UPDATE public.imoveis_leilao
SET fonte_id = 'cef_' || SUBSTRING(fonte_id FROM 5),
    atualizado_em = NOW()
WHERE fonte_id LIKE 'CEF-%'
  AND fonte = 'CEF';

-- 3. Desativa registros CEF que não foram atualizados nos últimos 7 dias (saíram do catálogo)
UPDATE public.imoveis_leilao
SET ativo = false,
    atualizado_em = NOW()
WHERE fonte = 'CEF'
  AND ativo = true
  AND atualizado_em < NOW() - INTERVAL '7 days';

-- Verificação final
SELECT
  COUNT(*) FILTER (WHERE ativo = true) AS ativos,
  COUNT(*) FILTER (WHERE ativo = false) AS inativos,
  COUNT(*) FILTER (WHERE fonte_id LIKE 'CEF-%') AS prefixo_antigo_restante
FROM public.imoveis_leilao
WHERE fonte = 'CEF';
