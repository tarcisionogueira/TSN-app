-- BRIGHT DATA — sobe o teto da sub-cota `geral` (21/09, pedido do dono).
--
-- POR QUE: `api/apurar-resultado-leilao-cron.js` foi adicionado como 3º consumidor de
-- `geral` (junto com enriquecer-datas-cron.js e enriquecer-backfill-cron.js) sem
-- rebalancear o orçamento — o teto ficou parado em 40/semana desde a divisão
-- geral/geral_cliente (03/09, brightdata_separa_geral_cliente_do_geral_cron.sql), quando
-- só havia 2 consumidores. Resultado medido: 40/40 já usados nesta semana, CEF (Caixa)
-- recusado com `sem_cota` mesmo com o TETO GLOBAL semanal (720) tendo 210 créditos já
-- pagos e ociosos (510/720 usados). O freio de orçamento estava certo em existir — só
-- desatualizado no número.
--
-- Não é um teto rígido "correto" — é o valor prévio à decisão de excluir CEF da
-- apuração, restaurado + folga, mesma lógica de dimensionamento já usada nesta tabela
-- (docs/gestao/soleon = 150; teto_dia = teto/6 arredondado). Segue dentro do teto global
-- de 720/semana, sem aumentar o custo do plano Bright Data.
update public.brightdata_reserva
   set teto = 150, teto_dia = 25,
       descricao = 'Crons de fundo que mantem o acervo enriquecido (enriquecer-datas-cron.js, enriquecer-backfill-cron.js) e a apuracao de resultado do leilao (apurar-resultado-leilao-cron.js, desde 21/09) - subiu de 40 para 150/semana porque o 3o consumidor foi adicionado sem rebalancear o orcamento.'
 where proposito = 'geral';
