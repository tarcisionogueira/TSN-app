-- Remove URLs de foto incorretas da CEF (padrão fotos/F*.jpg que não funciona)
-- Execute no SQL Editor do Supabase antes de rodar o scraper de fotos
UPDATE public.imoveis_leilao
SET link_foto = NULL
WHERE fonte = 'CEF'
  AND link_foto LIKE 'https://venda-imoveis.caixa.gov.br/fotos/F%';
