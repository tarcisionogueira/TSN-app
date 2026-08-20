-- Propósito Bright Data para o scraper LEILAOPRO (plataforma LeilãoPro Core: leffa/oscar, 20/08).
-- reserva=0 (não tira do bolo compartilhado, só rastreia); teto próprio 120 (acervo pequeno:
-- ~8-14 imóveis por tenant, poucas páginas). O teto GLOBAL (brightdata_uso.teto) é o freio real.
insert into public.brightdata_reserva (proposito, reserva, teto)
values ('leilaopro', 0, 120)
on conflict (proposito) do update set reserva = excluded.reserva, teto = excluded.teto;
