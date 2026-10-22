-- 22/10 (triagem #292): Arnaldo Leilões dá 403 ao IP do GitHub (página e AJAX de valores) — coleta pelo runner
-- residencial. Gate de 72 h, como as outras fontes pequenas do PC.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('ARNALDO', 72, true, array['ARNALDO'])
on conflict (fonte) do nothing;
