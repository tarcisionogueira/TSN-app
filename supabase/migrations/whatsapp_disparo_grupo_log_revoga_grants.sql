-- 11/09: achado do ritual de abertura — auditoria_uso() (health-check "Uso — RLS de escrita
-- do usuario") flagou whatsapp_disparo_grupo_log com RLS ligada mas SEM politica de escrita
-- para authenticated. Investigado: a tabela e SO-SERVIDOR por design (mesma regra da irma
-- whatsapp_disparo_log, ver comentario na migracao whatsapp_fila_grupo.sql — telefone/e-mail
-- de inscrito sao PII, só o service_role deve ler/escrever). RLS ja bloqueava (0 politicas =
-- nega por padrao), mas o `create table` deixou os GRANTS padrao (INSERT/UPDATE/DELETE/
-- TRUNCATE) abertos para anon/authenticated — a irma nunca teve esses grants. Revoga para
-- igualar o padrao da irma (defesa em profundidade; nao havia policy permitindo, mas o grant
-- de tabela nao deveria existir).
revoke insert, update, delete, truncate on public.whatsapp_disparo_grupo_log from anon, authenticated;
