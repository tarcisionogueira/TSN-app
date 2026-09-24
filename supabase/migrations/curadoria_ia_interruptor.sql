-- Curadoria das oportunidades: camada de IA ligada pelo dono em 24/09 (custo medido ~US$ 0,0055
-- por cliente/semana). Interruptor sem deploy — enviar-alertas-cron lê app_config.curadoria_ia
-- ('true' liga; qualquer outra coisa ou ausente = só a pontuação). Desligar:
--   update app_config set value = 'false', updated_at = now() where key = 'curadoria_ia';
insert into public.app_config (key, value, updated_at) values ('curadoria_ia', 'true', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
