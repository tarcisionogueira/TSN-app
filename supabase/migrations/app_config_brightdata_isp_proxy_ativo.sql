-- 22/09: interruptor no banco pro proxy ISP do Bright Data (api/apurar-resultado-leilao-cron.js),
-- sem precisar de redeploy pra desligar em caso de problema. 'true' preserva o comportamento
-- já em produção desde 22/09 — este INSERT não muda nada, só dá o controle.
insert into public.app_config (key, value)
values ('brightdata_isp_proxy_ativo', 'true')
on conflict (key) do nothing;
