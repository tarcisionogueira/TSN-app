-- 15/11 — #305: os crons de manutenção (desativar-encerrados, limpar-imoveis-stale, radar-editais,
-- enviar-alertas) caíam em 57014 "statement timeout" ~30×/dia desde 09/11.
--
-- CAUSA MEDIDA: o service_role não tem statement_timeout próprio e herda os 8 s do `authenticator`.
-- Com o banco no compute Micro (shared_buffers 256 MB, banco 1,5 GB), a mesma contagem de
-- `live_plataforma_numeros_atualizar` leva 12,4 s com o cache frio e 0,9 s com ele quente — o tempo é
-- disco, não SQL. Os máximos do pg_stat_statements param todos em ~7,9 s: é o corte, não a consulta.
--
-- ⚠️ `SET statement_timeout` NA FUNÇÃO NÃO RESOLVE (testado em 15/11): o relógio do comando externo já
-- está correndo quando a função muda o GUC — `pg_temp` com `set statement_timeout to '10s'` e
-- `pg_sleep(4)` sob sessão de 2 s caiu em 57014 aos 2 s. As funções que ganharam esse SET (anexos_expirados,
-- snapshot_metricas_fontes) NÃO ganharam teto maior pelo PostgREST; quem passa a dar é esta linha.
--
-- O PostgREST aplica as configurações do papel IMPERSONADO a cada transação (é o mesmo mecanismo que dá
-- 3 s ao anon e 8 s ao authenticated). 45 s cabe no maxDuration de 60 s das funções da Vercel.
-- O service_role só é usado no servidor (chave nunca vai ao navegador); anon/authenticated seguem 3 s/8 s.
alter role service_role set statement_timeout = '45s';
notify pgrst, 'reload config';
