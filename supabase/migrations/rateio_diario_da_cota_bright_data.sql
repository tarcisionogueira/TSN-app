-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A COTA DA SEMANA QUEIMAVA EM DOIS DIAS — 25/08/2026
--
-- `bd_teto_saturado` acusava 517 de 550. Olhando o histórico, o alerta era a ponta:
--     semana 24/08 (começou ontem)   517 / 550   94% em ~1,5 dia
--     semana 17/08                   618 / 550   112% — passou do teto global
--     semana 10/08                   480
-- A cota semanal é consumida em dois dias e os outros cinco ficam em `sem_cota`.
--
-- E ISSO NÃO É SÓ ORÇAMENTO: é a causa do que eu estava investigando em outro invariante.
-- CALIL, VEGAS e TORRES3 estão com a limpeza de encerrados congelada porque o último scrape
-- delas veio abaixo do piso — e veio abaixo do piso porque a coleta foi truncada por falta
-- de cota. Blackout de 5 dias → fonte sem coleta boa → freio de limpeza travado. A conta do
-- Bright Data acabava aparecendo como "regressão de captura" três camadas adiante.
--
-- A CAUSA: das 9 linhas de `brightdata_reserva`, só `docs` tinha `teto_dia`. As outras 8
-- tinham `teto_dia = null` — nenhum rateio diário. E a soma das sub-cotas SEMANAIS (1.390) é
-- quase o triplo do teto global (550): quem roda primeiro come a semana dos outros. Nesta
-- semana, soleon (112) e radar (106) sozinhos levaram 42% do teto global em um dia e meio.
--
-- A DECISÃO É DO DONO, e foi dele: ratear por dia, sem mexer no teto global. O gasto NÃO
-- sobe — segue 550/semana. O que muda é a distribuição. `teto_dia = teto_semanal / 7`:
--     radar 36 · ljud 26 · soleon 22 · gestao 22 · emiliomatos 22
--     certidao 18 · leilaopro 18 · rj 18        (docs já tinha 25, mantido)
--
-- Usa o mecanismo que já existia e estava testado em `docs` desde 18/08 (`brightdata_decisao`
-- checa o rateio diário ANTES da sub-cota semanal, porque "volta amanhã" é mais informativo
-- que "volta segunda"). Reversível com um UPDATE.
--
-- VERIFICADO logo após aplicar: `gestao` (30 usados hoje contra teto 22) e `soleon` (31
-- contra 22) passaram a recusar com motivo `subcota_dia`. Antes seguiriam consumindo.
--
-- ⚠️ DUAS RESSALVAS HONESTAS, para ninguém ler isto como garantia que não é:
--   1. A soma dos tetos diários é 207/dia, contra os ~78/dia que o teto global de 550
--      comportaria. Ou seja: isto IMPEDE que um propósito sozinho coma a semana — que é o que
--      estava acontecendo — mas não garante matematicamente 7 dias de cobertura se todos
--      rodarem no máximo todo dia. Se ainda faltar espalhamento, o ajuste é baixar os tetos
--      diários, não subir o global.
--   2. `geral` (99 esta semana) e `pecini` (63) NÃO têm linha em `brightdata_reserva`, então
--      seguem sem teto por propósito e sem rateio diário — só esbarram no global. O dono
--      optou por não fechá-los agora; fica registrado como o último ponto sem limite.
--   3. `rj` está no caminho das reservas dentro de `brightdata_decisao` e devolveu `ok` com
--      `teto_dia` nulo no JSON. Não confirmei se o rateio diário se aplica a propósito com
--      reserva — não medi, então não afirmo.
-- ─────────────────────────────────────────────────────────────────────────────────────────

update public.brightdata_reserva set teto_dia = v.d, atualizado_em = now()
  from (values ('radar',36),('ljud',26),('soleon',22),('gestao',22),('emiliomatos',22),
               ('certidao',18),('leilaopro',18),('rj',18)) as v(p, d)
 where brightdata_reserva.proposito = v.p;
