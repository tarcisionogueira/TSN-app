-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Curadoria das oportunidades (24/09): cada lote enviado guarda COMO foi escolhido, para medir
-- clique por método (api/_curadoria.js + enviar-alertas-cron.js).
--   curadoria: 'regra' (pontuação) | 'ia' (Haiku escolheu) | 'regra:ia_falhou' (IA ligada e caiu)
--   pontos:    nota da camada de pontuação no envio
-- Aplicada ANTES do deploy do cron — o insert passa a mandar essas colunas e o PostgREST daria
-- 400 com coluna inexistente (e o dedup de reenvio falharia em silêncio).
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.alertas_enviados add column if not exists curadoria text;
alter table public.alertas_enviados add column if not exists pontos numeric;
