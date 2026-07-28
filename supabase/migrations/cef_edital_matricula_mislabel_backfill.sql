-- Backfill: CEF — "Botão Edital abre a Matrícula" (edital_eq_matricula)
--
-- Contexto: até o commit b19df3c (26/07) o scraper de CEF (scripts/scraper.js)
-- gravava link_edital = "Link de acesso" do CSV, que para muitos lotes
-- extrajudiciais/licitação da Caixa É o PDF da MATRÍCULA (/editais/matricula/<UF>/<num>.pdf).
-- Resultado: o botão "Edital" abria a MATRÍCULA. O guard `linkEhMatriculaPdf`
-- (scripts/scraper.js) já corrige as coletas NOVAS (desvia o PDF de matrícula p/ a
-- página de detalhe), mas as ~1.8k linhas legadas só se auto-corrigem no próximo
-- re-scrape COMPLETO de CEF (roda ~2x/semana); enquanto isso, o workflow de captura
-- de matrícula bumpa atualizado_em sem re-rodar o mapeador, mantendo o link_edital velho.
--
-- Correção: para os lotes CEF onde link_edital == link_matricula (== PDF de matrícula),
-- aponta link_edital para a página de DETALHE do lote (url_lote) — exatamente o valor
-- que o scraper corrigido produz (link_edital = linkDetalhe = url_lote p/ não-venda-direta).
-- Idempotente: só toca linhas ainda coladas na matrícula; roda de novo = no-op.

-- Cobre tanto os lotes onde link_edital == link_matricula (colisão que o invariante
-- edital_eq_matricula pega) quanto os que têm link_edital = PDF de matrícula com
-- link_matricula ainda nulo/diferente (mesmo mis-label, fora do invariante).
-- /editais/matricula/ é, por definição, a MATRÍCULA — nunca é edital.
update public.imoveis_leilao
   set link_edital = url_lote
 where fonte = 'CEF'
   and link_edital ~ '/editais/matricula/'
   and url_lote is not null
   and url_lote <> link_edital;
