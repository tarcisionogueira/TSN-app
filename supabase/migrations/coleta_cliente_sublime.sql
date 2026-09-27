-- 27/09: SUBLIME entra no runner residencial (scraper-pecini.mjs com PECINI_TENANT=SUBLIME).
-- Sem esta linha o gate devolve FALSE e o runner pularia a fonte para sempre.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('SUBLIME', 72, true, array['SUBLIME'])
on conflict (fonte) do nothing;
