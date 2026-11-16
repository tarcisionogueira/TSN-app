-- BAYIT no runner residencial (16/11). O site recusa IP de datacenter, mas de IP residencial o feed /sitemap.xml
-- abre direto: a fonte deixa de ser a única no caminho pago do Bright Data. A linha no gate de coleta coordena o
-- runner (rodar BAYIT … BAYIT_NO_BD=1) com o workflow da CI, que pula a rodada paga quando houve coleta em 7 dias.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('BAYIT', 72, true, array['BAYIT'])
on conflict (fonte) do nothing;
