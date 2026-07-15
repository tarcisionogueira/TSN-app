-- Blindagem de segurança: funções SECURITY DEFINER de admin/cron NÃO devem ser
-- chamáveis por anon/authenticated via PostgREST (/rest/v1/rpc). Elas não têm guarda
-- interna de papel — confiam na rota de API (service_role), que já checa admin/cron.
-- Havia grant a PUBLIC (=X) + anon + authenticated, então um anônimo podia POSTar
-- direto na RPC (ex.: admin_busca_usuarios → busca de usuários/PII; limpar_analises_orfas
-- → deleção; enfileirar_docs_faltantes → flood da fila). O service_role mantém o EXECUTE
-- próprio, então os crons e o painel admin (chaves de serviço) seguem funcionando.
-- Reversível: para reabrir, GRANT EXECUTE ... TO <role>.
revoke execute on function public.admin_360_estatisticas()                     from public, anon, authenticated;
revoke execute on function public.admin_busca_usuarios(text, text)             from public, anon, authenticated;
revoke execute on function public.admin_busca_usuarios(text, text, text)       from public, anon, authenticated;
revoke execute on function public.arremate_aprendizado_resumo(text)            from public, anon, authenticated;
revoke execute on function public.arremate_juridico_resumo(text)               from public, anon, authenticated;
revoke execute on function public.enfileirar_docs_faltantes(integer)           from public, anon, authenticated;
revoke execute on function public.limpar_analises_orfas(integer, integer)      from public, anon, authenticated;
revoke execute on function public.moderador_gerar_insights()                   from public, anon, authenticated;
