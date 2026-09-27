-- 27/09: coletor MILAN (scraper-milan.mjs) — só o Web Unlocker passa o Cloudflare do site.
-- ~1 + nº de eventos de imóveis por rodada (27/09: ~6), 2 rodadas/semana + 1 retentativa de
-- corpo vazio por página → teto 30. Reserva 0: fonte nova não tira fatia dos coletores principais.
insert into public.brightdata_reserva (proposito, reserva, teto) values ('milan', 0, 30)
on conflict (proposito) do update set reserva = excluded.reserva, teto = excluded.teto;
