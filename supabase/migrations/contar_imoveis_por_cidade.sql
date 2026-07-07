-- Contagem de imóveis ATIVOS por cidade de um estado (para o selo de quantitativo
-- no filtro de Busca). Leitura pública (imoveis_leilao ativos já são públicos).
CREATE OR REPLACE FUNCTION public.contar_imoveis_por_cidade(uf text)
RETURNS TABLE(cidade_norm text, total bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT cidade_norm, count(*)::bigint
  FROM imoveis_leilao
  WHERE ativo = true
    AND estado = upper(uf)
    AND cidade_norm IS NOT NULL
    AND cidade_norm <> ''
  GROUP BY cidade_norm
$$;

GRANT EXECUTE ON FUNCTION public.contar_imoveis_por_cidade(text) TO anon, authenticated, service_role;
