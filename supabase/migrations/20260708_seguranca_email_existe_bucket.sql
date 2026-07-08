-- Segurança (advisors). Apenas o que é seguro sem quebrar RLS.
--
-- 1) email_existe(text): NÃO é usada em nenhuma policy (verificado) e o app só a
--    chama server-side (api/verificar-cpf.js com service key). Remover EXECUTE de
--    'authenticated' fecha a enumeração de contas por usuários logados, sem impacto.
revoke execute on function public.email_existe(text) from authenticated;

-- 2) Bucket público imoveis-fotos tinha DUAS policies SELECT idênticas. Remove a
--    duplicata (mantém 'Fotos imoveis leitura publica'); comportamento inalterado.
drop policy if exists "fotos publicas" on storage.objects;

-- NÃO revogamos is_admin()/is_equipe()/app_role() de authenticated: são usadas em
-- 32 policies de RLS (17+10+5) — o usuário autenticado PRECISA de EXECUTE para a
-- policy ser avaliada. Revogar quebraria o controle de acesso. A exposição via
-- /rpc é inócua (para anon retornam false/null). Ver docs/AUDITORIA.
