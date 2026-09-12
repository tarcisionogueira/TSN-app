-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIGHT DATA — reserva mínima semanal para 'certidao' (fallback do DJEN) (12/09)
-- ═══════════════════════════════════════════════════════════════════════════════
-- POR QUE (medido, não suposto): o DJEN (Comunica CNJ) já bloqueia o IP do servidor
-- com HTTP 403 (conhecido); o fallback via Bright Data (IP residencial) existe
-- exatamente para contornar isso (api/_laudo-fontes.js:consultarComunicaDJEN).
-- Mas o propósito 'certidao' nasceu com reserva=0 (brightdata_reserva_por_proposito.sql,
-- 11/08) — na semana de 12/09, com o teto global de 720 já em 660 usados e os 60
-- livres reservados inteiros para 'rj' (única fonte sem via grátis), brightdata_decisao
-- devolvia 'reservado_para_outros' para TODA chamada de certidao/DJEN, mesmo sem
-- nenhuma tê-la de fato consumido essa semana (uso real: 0 requests). O resultado:
-- todo documental gerado saía com DJEN "indisponível agora" — não por o DJEN estar
-- fora do ar, mas por não sobrar crédito NENHUM pro fallback que resolveria isso.
--
-- O QUE MUDA: reserva=20/semana para 'certidao' — abaixo do teto suave já existente
-- (120/semana, 18/dia) e pequeno frente ao teto global (720) — mas suficiente para
-- cobrir o uso real observado (semana de 31/08 fechou com 8 requests, 8 sucessos).
-- Efeito: essas 20 requisições ficam FORA da disputa com outros propósitos —
-- reduz o "reservado_alheio" que os demais veem, não aumenta o gasto total.
update public.brightdata_reserva
   set reserva = 20,
       descricao = 'Laudo/certidões (DJEN/Comunica CNJ, fallback do bloqueio 403) — reserva mínima semanal (12/09) para o fallback via Bright Data não ficar sem crédito quando o teto global está quase saturado por outros propósitos.',
       atualizado_em = now()
 where proposito = 'certidao';
