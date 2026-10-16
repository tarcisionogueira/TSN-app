-- Parceiro indicante: de 5% para 10% do honorário de êxito (16/10, decisão comercial do dono e do time).
--
-- Honorário de êxito = 10% do valor arrematado. O parceiro passa de 0,5 para 1,0 ponto percentual
-- do arrematado; jurídico e plataforma dividem meio a meio o restante (4,5 cada).
--   com parceiro:  parceiro 1,0 · jurídico 4,5 · plataforma 4,5
--   sem parceiro:  jurídico 5,0 · plataforma 5,0   (inalterado — calculado em api/_honorarios.js)
--
-- O que DECIDE o pagamento é `consultor_pct` (e `total_pct`/`analista_pct`); `advogado_pct` e
-- `admin_pct` NÃO são lidos pelo cálculo (ver api/_honorarios.js) — ficam como registro do acordo.
-- Arrematação já DISTRIBUÍDA não é recalculada (snapshot em arrematacoes.honorarios_split).
--
-- Termos atualizados no mesmo commit: TERMO_PARCEIRO_VERSAO v11 (item 3d) e
-- TERMO_JURIDICO_VERSAO v8 (item 6). Histórico: 1,0 até 14/09 → 0,5 (honorario_exito_parceiro_5pct.sql) → 1,0.
update public.config_honorarios
   set consultor_pct = 1.00, admin_pct = 4.50, advogado_pct = 4.50, atualizado_em = now()
 where id = 1;
