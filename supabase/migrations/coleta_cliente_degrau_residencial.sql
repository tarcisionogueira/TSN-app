-- 04/11: LEILAONET e POSITIVOLEIL (plataforma Degrau, scraper-leilaoeletronico.mjs) entram no runner residencial.
-- O feed /sitemap.xml responde 400 ao servidor do banco (pg_net) e 200 do IP residencial do dono — mesmo remédio
-- de LEJE/FREITAS. Sem esta linha o gate devolve FALSE e o runner pularia a fonte para sempre.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('DEGRAU_RESIDENCIAL', 72, true, array['LEILAONET','POSITIVOLEIL'])
on conflict (fonte) do nothing;
