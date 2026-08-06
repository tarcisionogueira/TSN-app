-- REFERÊNCIA CITÁVEL na base do relatório (pedido do dono, 06/08: o mercadológico pode se
-- resolver "pegando apenas os valores e referências para apresentar no relatório").
--
-- `indice_amostras` (a base do Índice) ganhou `url` hoje de manhã. `indice_amostra` (a base do
-- RELATÓRIO) só tinha `fonte` — o nome do portal — e a data. Sem link e sem endereço, um
-- comparável guardado não é AUDITÁVEL pelo cliente: ele lê "R$ 6.912/m², VivaReal, 2026-07" e
-- não tem como conferir. Isso passa a importar de verdade agora que o relatório em MODO BASE
-- apresenta a base no lugar da busca ao vivo.
--
-- As 1.549 amostras já existentes ficam sem link (a coluna não existia quando foram
-- capturadas): nelas a referência segue sendo fonte + mês. As novas nascem completas.

alter table public.indice_amostra
  add column if not exists url text,
  add column if not exists endereco text,
  add column if not exists condominio text;

comment on column public.indice_amostra.url is
  'Link do anuncio de origem. Sem ele o comparavel nao e auditavel pelo cliente no modo base.';
