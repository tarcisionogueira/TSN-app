-- Função para o dashboard: retorna tamanho do banco em MB
-- Execute no Supabase SQL Editor (requer permissão de superusuário ou service role)

CREATE OR REPLACE FUNCTION public.get_db_size_mb()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ROUND(pg_database_size(current_database()) / 1024.0 / 1024.0, 2);
$$;

-- Permissão: apenas usuários autenticados (o admin usa o service role implicitamente via RLS)
GRANT EXECUTE ON FUNCTION public.get_db_size_mb() TO authenticated;
