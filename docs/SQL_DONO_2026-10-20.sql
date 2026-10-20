-- ─────────────────────────────────────────────────────────────────────────────────────────
-- SQL para o DONO rodar no Supabase → SQL Editor (20/10, pendência #250).
-- O conector do Claude trava em UPDATE (pede confirmação que a sessão remota não exibe).
-- Tudo aqui é reversível e só mexe em 2 linhas de leiloeiro_conhecimento + 1 de fonte_regressao_explicada.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- 1) SBID21 = portal 21 da Superbid, que é o do PERU. Os 3 lotes da história inteira (jul–set) são peruanos e o
--    filtro BR descarta todos; a "regressão" de 18 → 1 media candidatos crus antes do filtro. A coleta já saiu do
--    scraper (commit de 20/10). Suspender tira a fonte do monitor de regressão para sempre (não só por 30 dias).
update leiloeiro_conhecimento
   set suspenso = true, suspenso_em = now(),
       suspenso_motivo = 'Suspenso 20/10 (#250): portal 21 da Superbid é o do PERU — 3 lotes na história, todos peruanos e descartados pelo filtro BR. O piso 18 vinha de candidatos crus antes do filtro (forma nº 10). Coleta retirada do scraper-puppeteer.'
 where fonte = 'SBID21';

-- 2) EMILIOMATOS está com suspenso = true desde 29/08, mas foi RELIGADO por você em 18/10 (#97, rota só
--    /emilio-matos-rocha/imoveis/ pelo Firecrawl). A flag esquecida deixa o monitor cego para ele: a 1ª rodada de
--    19/10 (35 lotes, parcial por cota) não é vigiada por ninguém.
update leiloeiro_conhecimento
   set suspenso = false, suspenso_em = null, suspenso_motivo = null,
       observacao = coalesce(observacao, '') || E'\n[20/10] Religado pelo dono em 18/10 (#97); suspenso=true esquecido cegava o monitor. Desfeito.'
 where fonte = 'EMILIOMATOS';

-- 3) Conferência (deve mostrar SBID21 = true e EMILIOMATOS = false):
select fonte, suspenso, suspenso_em from leiloeiro_conhecimento where fonte in ('SBID21', 'EMILIOMATOS');
