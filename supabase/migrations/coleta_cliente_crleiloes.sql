-- CRLEILOES no runner residencial (27/09): sem a linha o gate `coleta_cliente_claim` devolve false e
-- o runner pula a fonte em silêncio; o freio do workflow (coleta-recente.mjs) também lê daqui.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('CRLEILOES', 72, true, array['CRLEILOES'])
on conflict (fonte) do nothing;
