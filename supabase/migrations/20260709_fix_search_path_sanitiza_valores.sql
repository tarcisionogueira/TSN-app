-- Advisor Supabase (WARN 0011 function_search_path_mutable):
-- a função de trigger sanitiza_imovel_valores() estava com search_path mutável.
-- Ela só manipula colunas NEW.* (não referencia tabelas/funções), então fixar
-- search_path vazio é seguro e fecha o vetor de resolução de nome por role.
alter function public.sanitiza_imovel_valores() set search_path = '';
