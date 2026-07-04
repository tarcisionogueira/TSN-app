-- Correções de segurança (advisors Supabase). Aplicada via MCP.
-- (ERRO) View analítica rodava como SECURITY DEFINER (ignora RLS das tabelas base).
-- security_invoker = on faz a view respeitar as permissões de quem consulta. O
-- acesso via service key (backend) continua vendo tudo; anon/authenticated passam
-- a respeitar a RLS de casos/analise_juridica/perfis.
ALTER VIEW public.advogado_eficiencia SET (security_invoker = on);

-- (WARN) Funções sem search_path fixo: fixa em 'public' (evita sequestro de
-- search_path por role).
ALTER FUNCTION public.proteger_campos_sensiveis_perfil() SET search_path = public;
ALTER FUNCTION public.limite_ia(p_role text, p_tipo text) SET search_path = public;
