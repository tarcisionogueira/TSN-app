-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BRIGHT DATA: o propósito `leilaobrasil` consumia a cota paga SEM TETO — 24/09/2026
--
-- Achado pelo invariante `brightdata_proposito_sem_teto=1`: o scraper do Leilão Brasil
-- (scripts/lib/motor/fontes/leilaobrasil.mjs) já passava pelo ledger (`brightdata_uso_proposito`
-- registrou 15 requests na semana de 21/09), mas não havia linha em `brightdata_reserva` — ou
-- seja, o freio por propósito não existia para ele: só o teto global o segurava.
--
-- Medido: ~4 requests/dia (15 em 4 dias) → ~28/semana. Teto 40/semana e 8/dia dá folga para
-- oscilação normal do acervo (184 lotes) sem abrir brecha. Mesma forma dos outros propósitos.
-- ─────────────────────────────────────────────────────────────────────────────────────────
insert into public.brightdata_reserva (proposito, teto, teto_dia, reserva, isento_teto, descricao)
values ('leilaobrasil', 40, 8, 0, false,
        'Scraper Leilao Brasil (scripts/lib/motor/fontes/leilaobrasil.mjs) - teto criado 24/09 (uso medido ~4/dia, ~28/semana).')
on conflict (proposito) do update
   set teto = excluded.teto, teto_dia = excluded.teto_dia, descricao = excluded.descricao, atualizado_em = now();
