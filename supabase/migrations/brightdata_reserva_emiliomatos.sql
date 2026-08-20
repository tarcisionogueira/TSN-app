-- Propósito Bright Data para o scraper EMILIOMATOS (Superbid/MBV SSR, 20/08).
-- reserva=0 (não tira do bolo compartilhado, só rastreia); teto próprio 150, como soleon/gestao.
-- O teto GLOBAL (brightdata_uso.teto) continua sendo o freio de verdade.
insert into public.brightdata_reserva (proposito, reserva, teto)
values ('emiliomatos', 0, 150)
on conflict (proposito) do update set reserva = excluded.reserva, teto = excluded.teto;
