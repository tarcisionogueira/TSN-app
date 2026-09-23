-- 23/09 — Os 10 'vendido' SUPERBID gravados em 21-22/09 pelo cron de apuração (regex na página)
-- são falsos: o valor gravado era o lance mínimo e a offer-query mostrou totalBids=0 nos 3
-- conferidos (4970636, 5010073 sem lance; 5008418 retirado). Volta para "não apurado" e o
-- apurar-superbid-residencial.mjs reapura pela API. Só mexe no que o regex gravou
-- (resultado_origem nulo), nunca no que a apuração residencial gravar.
update imoveis_leilao
   set resultado_leilao = null, valor_lance_vencedor = null,
       resultado_apurado_em = null, resultado_apuracao_tentativas = 0
 where fonte in ('SUPERBID','SOLD') and resultado_leilao = 'vendido' and resultado_origem is null;
