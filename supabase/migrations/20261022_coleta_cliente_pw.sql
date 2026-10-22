-- 22/10 (triagem #292): PW Leilões entra no runner residencial (mesma plataforma do Pecini/Sublime, lance em
-- template JS — Chromium de casa). Gate de 72 h, igual aos irmãos.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('PW', 72, true, array['PW'])
on conflict (fonte) do nothing;
