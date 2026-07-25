-- Foto errada (CRÍTICO) — GESTAOLEILOES / "Lance no Leilão".
-- O scraper (scripts/scraper-gestao.mjs) fatiava os cards pela COLUNA DE TEXTO; a
-- imagem de cada lote fica na coluna que precede o texto do PRÓXIMO lote, então a
-- "1ª foto da fatia" era a foto do lote SEGUINTE → 100% das 107 fotos apontavam para
-- OUTRO imóvel (perda de credibilidade). Correção na origem: parseCard passa a casar
-- a foto cujo nome começa com o próprio idLote (<idLote>_NN.jpg) no HTML inteiro.
--
-- Backfill DETERMINÍSTICO das linhas existentes: o nome do arquivo é sempre prefixado
-- pelo idLote, então trocamos o prefixo (idLote errado) pelo idLote correto do fonte_id.
-- É garantidamente NUNCA-errado: resolve para a foto correta do lote ou, se não existir,
-- 404 → o <img onError> cai no placeholder (melhor nenhuma foto que a de outro imóvel).
-- Idempotente (só mexe onde o prefixo difere). Já aplicado em produção em 25/07/2026.
update public.imoveis_leilao
set link_foto = regexp_replace(link_foto, '/[0-9]+_([^/]*)$', '/' || replace(fonte_id,'gestao_','') || '_\1')
where fonte = 'GESTAOLEILOES'
  and link_foto ~ '/[0-9]+_[^/]*$'
  and (regexp_match(link_foto, '/([0-9]+)_[^/]*$'))[1] <> replace(fonte_id,'gestao_','');
