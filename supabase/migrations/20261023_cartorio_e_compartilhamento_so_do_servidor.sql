-- 23/10 — health-check (2×/dia) acusava: "2 tabela(s) com RLS mas SEM escrita do usuário —
-- servicos_cartorio(cliente_id,criado_por), veiculo_compartilhamento(criado_por)".
-- Mesmo caso e mesmo remédio de tabelas_so_do_servidor_perdem_o_grant_de_escrita.sql (01/09):
--   servicos_cartorio ......... só api/servicos-cartorio.js escreve (SERVICE_KEY)
--   veiculo_compartilhamento .. só api/veiculo-compartilhado.js escreve (SERVICE_KEY)
-- Nenhuma escrita (nem leitura) do navegador: `grep src/` não acha as duas, e nenhuma tem política de RLS.
-- Elas carregavam o default do Supabase (anon E authenticated com INSERT/UPDATE/DELETE/TRUNCATE) e só a RLS
-- segurava. Revoga-se a ESCRITA; o aviso some porque o fato mudou, não por allowlist. service_role intacto.
revoke insert, update, delete, truncate on public.servicos_cartorio        from anon, authenticated;
revoke insert, update, delete, truncate on public.veiculo_compartilhamento from anon, authenticated;
